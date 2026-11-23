/**
 * 标签页就地跳转标记。
 *
 * 默认可视页跳转会在顶部新增一个标签页；当在编辑页内切换上一张/下一张图片、
 * 上一份/下一份档案时，希望复用当前标签页。调用方在跳转前用目标路径登记，
 * 布局层的 openTab 消费该标记后会用目标页替换当前标签。
 */
const pendingReplacePaths = new Set<string>()

/** 登记下一次跳转目标，使其复用当前标签页 */
export const markTabReplace = (targetPath: string): void => {
  pendingReplacePaths.add(targetPath)
}

/** 消费标记，返回该路径是否应复用当前标签页 */
export const consumeTabReplace = (targetPath: string): boolean => {
  return pendingReplacePaths.delete(targetPath)
}
