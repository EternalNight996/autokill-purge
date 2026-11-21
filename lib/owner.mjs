// 业主身份（程序内置，不是运行时配置）
//
// YG 的代号是「梦神」：这套东西叫「梦神破甲」不是项目代号，是同一个名字在人身上的映射。
// 控制台页头、启动日志、插件注入都从这里取，避免各处手写漂移。
export const OWNER = Object.freeze({
  name: 'YG',
  codename: '梦神',
  display: '梦神（YG）',
  line: '业主：梦神（YG）',
  project: 'autokill-purge',
});

/** 一句话签名：用于日志、页脚、注入正文 */
export function ownerLine(prefix = '业主') {
  return `${prefix}：${OWNER.codename}（${OWNER.name}）`;
}

export default OWNER;
