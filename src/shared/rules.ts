import type { Action, Category } from './types'

export type RuleGroup = 'credentials' | 'personal'
export interface RuleSample { name: string; input: string; action: Action; hit: boolean }
export interface RuleDefinition {
  id: string
  group: RuleGroup
  category: Category
  name: string
  description: string
  boundary: string
  samples: RuleSample[]
}
const mask = (name: string, input: string): RuleSample => ({ name, input, action: 'MASK', hit: true })
const allow = (name: string, input: string): RuleSample => ({ name, input, action: 'ALLOW', hit: false })
const mnemonic12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMtdXNlciJ9.synthetic_signature_only'

// 目录同时供检测器、验证页面与回归样例使用；所有示例均为合成数据或公开测试向量。
export const RULES: RuleDefinition[] = [
  {
    id: 'private-pem', group: 'credentials', category: 'PRIVATE_KEY', name: '服务器私钥',
    description: '识别 PEM、RSA、EC、DSA、OpenSSH、加密私钥和 PGP 私钥块，整段识别。',
    boundary: '公钥和证书不按私钥处理；只有私钥文件路径、未带标记的任意密文无法据此判断。',
    samples: [
      mask('OpenSSH 服务器私钥', '-----BEGIN OPENSSH PRIVATE KEY-----\nSYNTHETIC_TEST_KEY_NOT_USABLE\n-----END OPENSSH PRIVATE KEY-----'),
      mask('RSA 私钥', '-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC_RSA_EXAMPLE\n-----END RSA PRIVATE KEY-----'),
      mask('加密私钥', '-----BEGIN ENCRYPTED PRIVATE KEY-----\nSYNTHETIC_ENCRYPTED_EXAMPLE\n-----END ENCRYPTED PRIVATE KEY-----'),
      mask('不完整私钥块', '-----BEGIN EC PRIVATE KEY-----\nSYNTHETIC_TRUNCATED_EXAMPLE'),
      mask('PGP 私钥', '-----BEGIN PGP PRIVATE KEY BLOCK-----\nSYNTHETIC_PGP_EXAMPLE\n-----END PGP PRIVATE KEY BLOCK-----'),
      allow('公钥', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISyntheticPublicKey demo-host'),
      allow('证书', '-----BEGIN CERTIFICATE-----\nSYNTHETIC_PUBLIC_CERTIFICATE\n-----END CERTIFICATE-----')
    ]
  },
  {
    id: 'private-value', group: 'credentials', category: 'PRIVATE_KEY', name: '明文私钥与签名密钥',
    description: '识别 private_key、secret_key、signing_key、私钥等明确字段中的密钥值。',
    boundary: '无字段提示的任意十六进制串可能是哈希，当前不将所有哈希都判为私钥。',
    samples: [
      mask('钱包十六进制私钥字段', 'private_key = "0x' + '0123456789abcdef'.repeat(4) + '"'),
      mask('服务器签名密钥', 'SIGNING_KEY=synthetic_server_signing_secret'),
      mask('中文私钥字段', '私钥：synthetic_private_value_123'),
      allow('普通文件哈希', '文件 SHA256：' + '0123456789abcdef'.repeat(4))
    ]
  },
  {
    id: 'api-key', group: 'credentials', category: 'API_KEY', name: 'API Key 与开发平台令牌',
    description: '识别常见 sk-、GitHub 令牌前缀，以及 api_key、client_secret 等明确字段。',
    boundary: '未知格式的裸字符串无法可靠识别；没有前缀时需要明确的密钥字段。',
    samples: [
      mask('模型 API Key', 'sk-proj-syntheticabcdefghijklmnopqrstuvwx'),
      mask('GitHub 令牌', 'ghp_SYNTHETIC1234567890ABCDEFGHIJ'),
      mask('任意服务的 API Key 字段', '{"api_key":"synthetic_service_secret_123"}'),
      mask('OAuth 客户端密钥', 'client_secret=synthetic_client_secret_123'),
      allow('API Key 的说明文字', '这里介绍 API Key 的申请方法，没有填写任何密钥。')
    ]
  },
  {
    id: 'cloud-key', group: 'credentials', category: 'API_KEY', name: '云服务访问密钥',
    description: '识别 AWS、阿里云、腾讯云访问密钥前缀，以及 access_key_id、secret_access_key 等字段。',
    boundary: '访问标识本身也按凭据识别；不会向云平台尝试验证或使用密钥。',
    samples: [
      mask('AWS 访问标识', 'AKIASYNTHETIC1234567'),
      mask('阿里云访问标识', 'LTAISynthetic1234567890ABCDE'),
      mask('腾讯云访问标识', 'AKIDSynthetic1234567890ABCDEFGHIJK'),
      mask('云端 Secret 字段', 'AWS_SECRET_ACCESS_KEY=synthetic_cloud_secret_123'),
      allow('云服务名称', 'AWS、阿里云、腾讯云均可自行配置访问权限。')
    ]
  },
  {
    id: 'credential-url', group: 'credentials', category: 'CREDENTIAL', name: '服务器与数据库连接凭据',
    description: '识别带用户名和密码的数据库、SSH、SFTP、HTTP 等连接字符串。',
    boundary: '仅有主机、端口或无密码的连接地址不按凭据处理。',
    samples: [
      mask('PostgreSQL 连接串', 'postgresql://demo_user:synthetic_password@db.example.com:5432/demo'),
      mask('Redis 连接串', 'redis://default:synthetic_password@localhost:6379/0'),
      mask('SSH 连接串', 'ssh://demo_user:synthetic_password@server.example.com'),
      mask('HTTP URL 认证', 'https://demo_user:synthetic_password@service.example.com'),
      allow('不含密码的地址', 'postgresql://localhost:5432/demo')
    ]
  },
  {
    id: 'password', group: 'credentials', category: 'PASSWORD', name: '账号密码',
    description: '识别 password、passwd、pwd、密码、口令字段，支持 JSON、环境变量及带空格的引号值。',
    boundary: '不把普通说明中的「密码」二字当作凭据；需要赋值或字段内容。',
    samples: [
      mask('环境变量密码', 'DB_PASSWORD=synthetic_password_123'),
      mask('JSON 密码', '{"password":"synthetic password with spaces"}'),
      mask('中文账号密码', '账号：demo_account\n密码：synthetic_password_123'),
      mask('短密码', 'pwd=123'),
      allow('密码使用说明', '请定期更换密码，并开启双重认证。')
    ]
  },
  {
    id: 'oauth-token', group: 'credentials', category: 'OAUTH_TOKEN', name: 'OAuth Token',
    description: '识别正文里的 Bearer 认证、access_token、refresh_token、id_token 与 oauth_token 字段。',
    boundary: '检测的是消息正文。客户端调用模型所需的认证 Header 由路由单独处理，不作为 Prompt 检测。',
    samples: [
      mask('Bearer 认证头文本', 'Authorization: Bearer synthetic_access_token_123456789'),
      mask('Access Token', '{"access_token":"synthetic_access_123456789"}'),
      mask('Refresh Token', 'refresh_token=synthetic_refresh_123456789'),
      mask('ID Token', 'id_token=synthetic_id_token_123456789'),
      mask('回调 URL 中的 Token', 'https://example.com/callback?access_token=synthetic_access_123456&expires_in=3600'),
      allow('OAuth 流程说明', 'OAuth 使用访问令牌与刷新令牌完成授权。')
    ]
  },
  {
    id: 'jwt', group: 'credentials', category: 'OAUTH_TOKEN', name: 'JWT / JWE 令牌',
    description: '识别具有 JSON 头部特征的三段 JWT 或五段 JWE 文本。',
    boundary: '仅识别令牌形态，不验证签名、有效期或权限；不尝试使用令牌。',
    samples: [mask('裸 JWT', jwt), mask('JSON 中的 JWT', '{"session":"' + jwt + '"}'),
      mask('五段 JWE 形态', 'eyJhbGciOiJkaXIifQ..syntheticIV.syntheticCiphertext.syntheticTag'),
      allow('普通点分文本', 'version.one.two')]
  },
  {
    id: 'mnemonic-bip39', group: 'credentials', category: 'MNEMONIC', name: 'BIP39 助记词',
    description: '本地识别 12、15、18、21、24 词助记词，使用十种官方字典与 SHA-256 校验。',
    boundary: '中文词需有空格或标点分隔，连续汉字使用明确的助记词字段；不支持所有自定义钱包词表。',
    samples: [
      mask('英文 12 词公开测试向量', mnemonic12),
      mask('英文 24 词公开测试向量', Array(23).fill('abandon').join(' ') + ' art'),
      mask('中文 12 词公开测试向量', Array(11).fill('的').join(' ') + ' 在'),
      allow('校验不符的无标注单词', Array(12).fill('abandon').join(' ')),
      allow('普通中文句子', '今天整理项目需求，明天继续检查页面和功能。')
    ]
  },
  {
    id: 'mnemonic-labeled', group: 'credentials', category: 'MNEMONIC', name: '明确标注的助记词',
    description: '识别助记词、seed phrase、recovery phrase、mnemonic 字段后的 12–33 词内容或 12–33 个连续汉字。',
    boundary: '字段提示足够明确时，即使校验不符也识别，避免漏掉抄写错误或其他词表；仅谈论助记词不会命中。',
    samples: [
      mask('标注后即使校验不符也识别', 'seed phrase: ' + Array(12).fill('abandon').join(' ')),
      mask('连续中文助记词', '助记词：' + '的'.repeat(11) + '在'),
      mask('其他词表的恢复短语', 'recovery phrase: synthetic alpha beta gamma delta epsilon zeta eta theta iota kappa lambda'),
      allow('助记词保管说明', '助记词用于恢复钱包，不要分享给其他人。')
    ]
  },
  {
    id: 'email', group: 'personal', category: 'EMAIL', name: '邮箱',
    description: '识别邮箱地址，将完整地址替换为当前请求的代号。',
    boundary: '当前不支持所有国际化邮箱及故意拆分、混淆的写法。',
    samples: [mask('普通邮箱', '请联系 demo.person@example.com'), mask('带标签的邮箱', 'demo.person+test@example.org'),
      allow('不完整地址', 'example.com 是一个域名。')]
  },
  {
    id: 'phone-cn', group: 'personal', category: 'PHONE', name: '中国大陆手机号',
    description: '识别 11 位手机号、+86 前缀与常见空格、短横线分隔。',
    boundary: '不代表号码真实存在；国际电话、座机与其他国家号码尚未完整覆盖。',
    samples: [mask('11 位手机号', '演示号码 13800138000'), mask('国家码与分隔符', '+86 138-0013-8000'),
      mask('空格分隔', '138 0013 8000'), allow('普通短数字', '订单编号 123456')]
  },
  {
    id: 'id-cn', group: 'personal', category: 'ID_CARD', name: '中国居民身份证',
    description: '识别 18 位居民身份证的地区、出生日期和末位字符格式，支持 X / x。',
    boundary: '以隐私保护为目的做格式匹配，不验证证件真实性、行政区划或校验位；其他证件需另行适配。',
    samples: [mask('18 位格式样例', '身份证：110101199001010015'), mask('末位 X 的格式样例', '证件号码 11010519491231002x'),
      allow('日期格式不符的长数字', '编号 110101199013010015')]
  },
  {
    id: 'account', group: 'personal', category: 'ACCOUNT', name: '账号名称',
    description: '识别 username、user_name、login、account、用户名、账号字段并替换账号值。',
    boundary: '不推断普通句子里的人名；账号与密码分别识别，按当前规则处理。',
    samples: [mask('登录账号字段', 'username=demo_account_123'), mask('中文账号字段', '账号：demo_account'),
      allow('账号操作说明', '可以在设置页面更改账号名称。')]
  }
]

export const CATEGORY_NAMES: Record<Category, string> = {
  API_KEY: 'API Key', PRIVATE_KEY: '私钥', CREDENTIAL: '连接凭据', PASSWORD: '密码',
  OAUTH_TOKEN: 'OAuth Token', MNEMONIC: '助记词', EMAIL: '邮箱', PHONE: '手机号', ID_CARD: '身份证', ACCOUNT: '账号', CUSTOM: '自定义内容'
}
export const PERSONAL_CATEGORIES: Category[] = ['EMAIL', 'PHONE', 'ID_CARD', 'ACCOUNT']
