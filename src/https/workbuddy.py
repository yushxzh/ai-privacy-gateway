"""WorkBuddy 原生 JSON 模型请求的 TLS 入口；检测与记录由桌面进程处理。"""
import asyncio
import json
import os
import urllib.request
from urllib.parse import unquote
import re
import zlib
import posixpath
from mitmproxy import http

HOST = 'www.workbuddy.ai'
MODEL_PATH = '/v2/chat/completions'
LIMIT = 4 * 1024 * 1024
BRIDGE = os.environ['APG_NATIVE_BRIDGE_URL']
TOKEN = os.environ['APG_NATIVE_BRIDGE_TOKEN']

def only_keys(value, keys):
    if not isinstance(value, dict) or any(key not in keys for key in value):
        raise ValueError('unsupported fields')

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.:/-]{1,200}', value):
        raise ValueError('unsupported identifier')

def collect(value, path):
    if isinstance(value, str): return [{'path':path, 'text':value}]
    if isinstance(value, list): return [f for i,v in enumerate(value) for f in collect(v,path+[i])]
    if isinstance(value, dict):
        if value.get('type') in ('image_url','image','input_audio','audio','file','input_file'):
            raise ValueError('unsupported non-text content')
        only_keys(value, ('type', 'text', 'cache_control'))
        if value.get('type') != 'text' or not isinstance(value.get('text'), str):
            raise ValueError('unsupported content block')
        if 'cache_control' in value and value['cache_control'] != {'type': 'ephemeral'}:
            raise ValueError('unsupported cache control')
        return collect(value['text'], path+['text'])
    if value is not None: raise ValueError('unsupported text')
    return []

def data_fields(value, path):
    if isinstance(value, str): return [{'path': path, 'text': value}]
    if isinstance(value, list): return [f for i,v in enumerate(value) for f in data_fields(v,path+[i])]
    if isinstance(value, dict): return [f for k,v in value.items() for f in data_fields(v,path+[k])]
    return []

def model_endpoint(flow):
    path = flow.request.path.split('?')[0]
    # 编码、大小写或尾斜杠变化仍属于模型端点；不允许借此进入范围外转发。
    for _ in range(2): path = unquote(path)
    path = posixpath.normpath(re.sub(r'/+', '/', path.replace('\\', '/')))
    return bool(re.fullmatch(r'/v\d+/(chat/completions|responses|messages)(/.*)?', path.lower()))

def fields_for(body):
    only_keys(body, ('model', 'messages', 'stream', 'system', 'tools', 'tool_choice', 'parallel_tool_calls',
        'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'frequency_penalty', 'presence_penalty',
        'n', 'stop', 'stream_options', 'thinking', 'reasoning_effort', 'extra_vars'))
    identifier(body.get('model'))
    if not isinstance(body.get('messages'), list) or not 1 <= len(body['messages']) <= 1000:
        raise ValueError('unsupported messages')
    if 'stream' in body and not isinstance(body['stream'], bool): raise ValueError('unsupported stream')
    for key in ('temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'frequency_penalty', 'presence_penalty', 'n'):
        if key in body and (isinstance(body[key], bool) or not isinstance(body[key], (float, int))):
            raise ValueError('unsupported generation parameter')
    if 'parallel_tool_calls' in body and not isinstance(body['parallel_tool_calls'], bool):
        raise ValueError('unsupported tool option')
    if 'stream_options' in body:
        only_keys(body['stream_options'], ('include_usage',))
        if not isinstance(body['stream_options'].get('include_usage'), bool): raise ValueError('unsupported stream options')
    if 'thinking' in body and body['thinking'] != {'type': 'disabled'}: raise ValueError('unsupported thinking')
    if 'reasoning_effort' in body and body['reasoning_effort'] not in ('none', 'low', 'medium', 'high'):
        raise ValueError('unsupported reasoning option')
    choice = body.get('tool_choice', 'auto')
    if isinstance(choice, dict):
        only_keys(choice, ('type', 'function'))
        only_keys(choice.get('function'), ('name',))
        if choice.get('type') != 'function': raise ValueError('unsupported tool choice')
        identifier(choice['function'].get('name'))
    elif choice not in ('auto', 'none', 'required'): raise ValueError('unsupported tool choice')
    result = []
    if 'extra_vars' in body:
        if not isinstance(body['extra_vars'], dict): raise ValueError('unsupported provider metadata')
        result.extend(data_fields(body['extra_vars'], ['extra_vars']))
    for i, message in enumerate(body['messages']):
        only_keys(message, ('role', 'content', 'name', 'tool_call_id', 'tool_calls', 'reasoning_content',
            'agent', 'messageId', 'model', 'requestModelId', 'requestModelName', 'traceId',
            'conversationRequestId', 'rawUsage', 'usage'))
        if message.get('role') not in ('system', 'developer', 'user', 'assistant', 'tool'):
            raise ValueError('unsupported role')
        for key in ('name', 'tool_call_id'):
            if key in message: identifier(message[key])
        result.extend(collect(message.get('content'), ['messages',i,'content']))
        if 'reasoning_content' in message: result.extend(collect(message['reasoning_content'], ['messages',i,'reasoning_content']))
        if 'tool_calls' in message and not isinstance(message['tool_calls'], list): raise ValueError('unsupported tool calls')
        for j, call in enumerate(message.get('tool_calls') or []):
            only_keys(call, ('id', 'type', 'function', 'index'))
            if call.get('type') != 'function': raise ValueError('unsupported tool call')
            identifier(call.get('id'))
            if 'index' in call and not isinstance(call['index'], int): raise ValueError('unsupported tool index')
            only_keys(call.get('function'), ('name', 'arguments'))
            identifier(call['function'].get('name'))
            if not isinstance(call['function'].get('arguments'), str): raise ValueError('unsupported tool arguments')
            result.extend(collect(call['function']['arguments'], ['messages',i,'tool_calls',j,'function','arguments']))
        # 保留客户端元数据结构，其字符串值也接受检查，不能夹带未检查文字。
        for key in ('agent', 'messageId', 'model', 'requestModelId', 'requestModelName', 'traceId', 'conversationRequestId', 'rawUsage', 'usage'):
            if key in message: result.extend(data_fields(message[key], ['messages',i,key]))
    if 'system' in body: result.extend(collect(body['system'],['system']))
    if 'stop' in body: result.extend(collect(body['stop'], ['stop']))
    if 'tools' in body:
        if not isinstance(body['tools'], list): raise ValueError('unsupported tools')
        for i, tool in enumerate(body['tools']):
            only_keys(tool, ('type', 'function'))
            if tool.get('type') != 'function': raise ValueError('unsupported tool')
            fn = tool.get('function')
            only_keys(fn, ('name', 'description', 'parameters', 'strict'))
            identifier(fn.get('name'))
            if 'strict' in fn and not isinstance(fn['strict'], bool): raise ValueError('unsupported strict')
            if 'description' in fn: result.extend(collect(fn['description'], ['tools',i,'function','description']))
            if 'parameters' in fn:
                if not isinstance(fn['parameters'], dict): raise ValueError('unsupported schema')
                result.extend(data_fields(fn['parameters'], ['tools',i,'function','parameters']))
    return result

def request_body(flow):
    raw = flow.request.raw_content or b''
    if len(raw) > LIMIT: raise ValueError('body too large')
    encoding = flow.request.headers.get('content-encoding', 'identity').lower()
    if encoding in ('gzip', 'deflate'):
        decoder = zlib.decompressobj(16 + zlib.MAX_WBITS if encoding == 'gzip' else zlib.MAX_WBITS)
        raw = decoder.decompress(raw, LIMIT + 1)
        if len(raw) > LIMIT or not decoder.eof or decoder.unused_data: raise ValueError('invalid compressed body')
    elif encoding != 'identity': raise ValueError('unsupported encoding')
    def unique(pairs):
        value = {}
        for k,v in pairs:
            if k in value: raise ValueError('duplicate field')
            value[k] = v
        return value
    def invalid_number(_value): raise ValueError('non-finite number')
    return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid_number)

def replace_at(body, path, value):
    target = body
    for part in path[:-1]: target = target[part]
    target[path[-1]] = value

def bridge_call(path, data):
    request = urllib.request.Request(BRIDGE+path, data=json.dumps(data).encode(), method='POST',
      headers={'content-type':'application/json','authorization':'Bearer '+TOKEN})
    # 此连接始终留在回环地址，忽略用户环境中的外部代理。
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request,timeout=10) as response:
        return json.load(response)

async def call(path, data): return await asyncio.to_thread(bridge_call,path,data)

async def watch_bridge():
    failures = 0
    while True:
        await asyncio.sleep(2)
        try:
            await call('/health', {})
            failures = 0
        except Exception:
            failures += 1
            if failures >= 3:
                # 桌面进程消失后释放端口；其间请求仍因检查失败而停止。
                from mitmproxy import ctx
                ctx.master.shutdown()
                return

async def running():
    await call('/ready',{})
    asyncio.create_task(watch_bridge())

def block(flow, status, message):
    flow.response = http.Response.make(status, json.dumps({'error':{'message':message,'type':'privacy_gateway'}}).encode(),
                                       {'content-type':'application/json; charset=utf-8'})

def requestheaders(flow: http.HTTPFlow):
    # 正文通过检查前不能开始向上游发送。
    flow.request.stream = False

async def request(flow: http.HTTPFlow):
    if flow.request.host != HOST: return
    # 按端点确定检查义务；格式变化、非 JSON 和 WebSocket 升级不能跳过检查。
    if not model_endpoint(flow):
        try: await call('/unchecked', {'issue': 'outside-scope'})
        except Exception: pass
        return
    try:
        if flow.request.path != MODEL_PATH: raise ValueError('unsupported model endpoint or query')
        if flow.request.method != 'POST' or flow.request.headers.get('upgrade'):
            raise ValueError('unsupported method')
        if flow.request.headers.get('content-type','').split(';')[0].strip().lower() != 'application/json':
            raise ValueError('unsupported media type')
        body=request_body(flow)
        fields=fields_for(body)
        if not fields: raise ValueError('no supported content')
    except Exception:
        block(flow,422,'当前模型请求格式尚不支持，本地已停止外发。请在 Privacy Gateway 查看记录。')
        try: await call('/unchecked', {'issue': 'unsupported'})
        except Exception: pass
        return
    try:
        # 只在内存中比较认证相关头，绝不提交给 App 或写入日志。
        auth=lambda: [(k,v) for k,v in flow.request.headers.items(multi=True)
                      if k.lower() not in ('content-length','content-encoding')]
        before=auth()
        result=await call('/inspect',{'host':HOST,'path':flow.request.path.split('?')[0],
                        'model':body['model'],'stream':body.get('stream') is True,'fields':fields})
        flow.metadata['apg_id']=result['id']
        if result['action']=='BLOCK':
            # 内容策略拒绝不是身份失效，避免使用客户端通常用于重新登录的 401 / 403。
            block(flow,422,'本地规则设置为阻断，请在 Privacy Gateway 的规则页调整处理动作。');return
        for field in result['fields']: replace_at(body,field['path'],field['text'])
        flow.request.headers.pop('content-encoding', None)
        flow.request.text=json.dumps(body,ensure_ascii=False,separators=(',',':'))
        actual=(flow.request.raw_content or b'').decode('utf-8')
        await call('/confirm',{'id':result['id'],'body':actual,'authenticationUnchanged':before==auth()})
        flow.metadata['apg_confirmed']=True
    except Exception:
        block(flow,502,'本地 HTTPS 隐私检查失败，请求未发送。')
        if 'apg_id' in flow.metadata:
            try: await call('/finish',{'id':flow.metadata['apg_id'],'failed':True})
            except Exception: pass
        else:
            try: await call('/unchecked', {'issue': 'check-failed'})
            except Exception: pass

def responseheaders(flow: http.HTTPFlow):
    # 原服务的 SSE 保持实时返回；本轮不恢复流式代号。
    flow.response.stream=True

async def response(flow: http.HTTPFlow):
    if flow.metadata.get('apg_confirmed'):
        try: await call('/finish',{'id':flow.metadata['apg_id'],'status':flow.response.status_code})
        except Exception: pass

async def error(flow: http.HTTPFlow):
    if 'apg_id' in flow.metadata:
        try: await call('/finish',{'id':flow.metadata['apg_id'],'failed':True})
        except Exception: pass
    elif flow.request.host == HOST and model_endpoint(flow):
        try: await call('/unchecked', {'issue': 'check-failed'})
        except Exception: pass
