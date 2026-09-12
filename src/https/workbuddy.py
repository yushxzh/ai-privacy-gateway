"""WorkBuddy 原生 JSON 模型请求的 TLS 入口；检测与记录由桌面进程处理。"""
import asyncio
import json
import os
import urllib.request
from mitmproxy import http

HOST = 'www.workbuddy.ai'
LIMIT = 4 * 1024 * 1024
BRIDGE = os.environ['APG_NATIVE_BRIDGE_URL']
TOKEN = os.environ['APG_NATIVE_BRIDGE_TOKEN']

def collect(value, path):
    if isinstance(value, str): return [{'path':path, 'text':value}]
    if isinstance(value, list): return [f for i,v in enumerate(value) for f in collect(v,path+[i])]
    if isinstance(value, dict):
        if value.get('type') in ('image_url','image','input_audio','audio','file','input_file'):
            raise ValueError('unsupported non-text content')
        # 保留协议标识；内容、工具参数和描述才进入文本检测。
        return [f for k,v in value.items() if k in ('text','content','description','arguments','reasoning_content','thinking')
                for f in collect(v,path+[k])]
    return []

def fields_for(body):
    result = []
    for i, message in enumerate(body['messages']):
        if not isinstance(message,dict): raise ValueError('unsupported message')
        result.extend(collect(message,['messages',i]))
        for j, call in enumerate(message.get('tool_calls') or []):
            if isinstance(call,dict) and isinstance(call.get('function'),dict):
                result.extend(collect(call['function'],['messages',i,'tool_calls',j,'function']))
    if 'system' in body: result.extend(collect(body['system'],['system']))
    def descriptions(value,path):
        if isinstance(value,list): return [f for i,v in enumerate(value) for f in descriptions(v,path+[i])]
        if isinstance(value,dict):
            return [f for k,v in value.items() for f in
                    (collect(v,path+[k]) if k in ('description','default','examples') else descriptions(v,path+[k]))]
        return []
    if 'tools' in body: result.extend(descriptions(body['tools'],['tools']))
    return result

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
    if flow.request.host != HOST or flow.request.method != 'POST': return
    if 'json' not in flow.request.headers.get('content-type','').lower(): return
    try:
        if len(flow.request.content or b'') > LIMIT: raise ValueError('body too large')
        body=json.loads(flow.request.content or b'{}')
        if not isinstance(body,dict) or not isinstance(body.get('messages'),list) or not isinstance(body.get('model'),str): return
        fields=fields_for(body)
        if not fields: raise ValueError('no supported content')
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
        flow.request.decode()
        flow.request.text=json.dumps(body,ensure_ascii=False,separators=(',',':'))
        actual=(flow.request.raw_content or b'').decode('utf-8')
        await call('/confirm',{'id':result['id'],'body':actual,'authenticationUnchanged':before==auth()})
        flow.metadata['apg_confirmed']=True
    except Exception:
        block(flow,502,'本地 HTTPS 隐私检查失败，请求未发送。')
        if 'apg_id' in flow.metadata:
            try: await call('/finish',{'id':flow.metadata['apg_id'],'failed':True})
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
