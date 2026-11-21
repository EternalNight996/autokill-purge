// 业主身份（插件内自带一份）
//
// 插件发布时是独立包，不能 import 仓库根的 lib/owner.mjs；这里复制同一份常量，
// 保证「宿主内注入」和「控制台页头」说的是同一个名字。
export const OWNER = Object.freeze({
  name: 'YG',
  codename: '梦神',
  display: '梦神',
  line: '业主：梦神',
  project: 'autokill-purge',
});

export const OWNER_LINE = OWNER.line;

export default OWNER;
