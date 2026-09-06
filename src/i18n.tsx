/**
 * src/i18n.tsx —— 全站 CN/EN 国际化（v1.2.0）。
 *
 * 设计要点：
 *  - 零新增依赖：直接复用 zustand 做 lang 全局状态（与 store.ts 分开，避免循环依赖）；
 *  - `t(key, vars?)` 是纯函数：非组件模块（columns/filter/store 消息等）也能用，
 *    但它读的是 store 当前快照 —— 组件里要拿到「切语言后自动重渲染」必须用 `useT()`；
 *  - 字典扁平化（`toolbar.save` 点分键），zh 为唯一真源，en 缺键时回退 zh，
 *    zh 也缺则返回键本身（开发期肉眼可见漏翻）；
 *  - 持久化 localStorage（`ppwc.lang`），默认 'zh'（与既有行为一致，测试不受影响）；
 *  - `setLang` 同步 `document.documentElement.lang` 与 `<title>`。
 */

import { create } from 'zustand';
import { ErrCode, ERR_CODE_LABEL } from '../shared/types';

export type Lang = 'zh' | 'en';

const LANG_KEY = 'ppwc.lang';

function readInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* 隐私模式 / 存储禁用 → 静默降级 */
  }
  return 'zh';
}

interface LangState {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggle: () => void;
}

export const useLangStore = create<LangState>((set, get) => ({
  lang: readInitialLang(),
  setLang: (lang) => {
    set({ lang });
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* 忽略 */
    }
    applyLangToDocument(lang);
  },
  toggle: () => get().setLang(get().lang === 'zh' ? 'en' : 'zh'),
}));

/** 把 lang 同步到 <html lang> 与 <title>（title 也做双语） */
function applyLangToDocument(lang: Lang): void {
  try {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = lang === 'zh' ? DOC_TITLE_ZH : DOC_TITLE_EN;
  } catch {
    /* SSR / 测试环境无 document → 忽略 */
  }
}

export const DOC_TITLE_ZH = 'Project Planning with Checklist';
export const DOC_TITLE_EN = 'Project Planning with Checklist';

/* ============================ 字典 ============================ */

const zh: Record<string, string> = {
  /* —— 通用 —— */
  'common.ok': '确定',
  'common.cancel': '取消',
  'common.close': '关闭',
  'common.save': '保存',
  'common.delete': '删除',
  'common.edit': '编辑',
  'common.add': '添加',
  'common.loading': '加载中…',
  'common.none': '无',
  'common.all': '全部',
  'common.search': '搜索',
  'common.confirm': '确认',
  'common.reset': '重置',
  'common.retry': '重试',
  'common.copy': '复制',
  'common.copied': '已复制',
  'common.row': '行',

  /* —— 列名 —— */
  'col.seq': '行号',
  'col.name': '任务名称',
  'col.start': '开始',
  'col.end': '结束',
  'col.duration': '时长',
  'col.deps': '依赖',
  'col.owner': '负责人',
  'col.consultant': '顾问人',
  'col.todo': 'TODO',
  'col.actions': '操作',

  /* —— 诊断条 / 横幅 —— */
  'diag.errors': '{n} 个错误',
  'diag.warns': '{n} 个提醒',
  'diag.hint': '（错误会阻止保存，点击可定位到行）',
  'diag.collapse': '折叠',
  'diag.expand': '展开',
  'diag.rowN': '行{seq}',
  'banner.calendarOk': '工作日历已生效（覆盖年份 {years}）',
  'banner.calendarWarn': '当前年份（{year}）未在日历覆盖范围内，已降级为仅周末规则',
  'empty.title': '尚未打开任何计划',
  'empty.openPlan': '打开 / 新建计划',
  'empty.pickUserFirst': '请先选择身份',
  'preview.banner': '正在预览 v{version}（只读）',
  'preview.by': '由 {editor} 提交：{notes}',
  'preview.exit': '退出预览',

  /* —— 错误码（键名 = shared/types ErrCode 枚举名；zh 与 ERR_CODE_LABEL 完全一致） —— */
  'err.ERR_VALIDATION': '校验失败',
  'err.ERR_NOTES_REQUIRED': '变更纪要必填',
  'err.ERR_OVER_CONSTRAINED': '过度约束（开始/结束/时长最多填 2 个）',
  'err.ERR_CYCLE': '循环依赖',
  'err.ERR_DEP_PARSE': '依赖表达式非法',
  'err.WARN_DEP_CONFLICT': '与依赖冲突',
  'err.ERR_INVALID_DATE': '日期非法',
  'err.ERR_DURATION_PARSE': '时长非法',
  'err.ERR_DEP_TARGET_MISSING': '依赖行号不存在',
  'err.ERR_DEP_SELF': '不能依赖自己',
  'err.ERR_DEP_ANCESTOR': '不能依赖自己的祖先/后代',
  'err.WARN_PARENT_DEP_IGNORED': '父任务依赖被忽略',
  'err.ERR_NEGATIVE_DURATION': '结束不得早于开始',
  'err.ERR_PARENT_CYCLE': '父子层级成环',
  'err.WARN_PARENT_INPUT_IGNORED': '父任务手填时间被忽略',
  'err.WARN_UNSCHEDULED': '无约束，已落到锚点日期',
  'err.WARN_DURATION_DEFAULTED': '时长缺省为 1d',
  'err.WARN_REDUNDANT_INPUT': '三者同填但一致',
  'err.ERR_SCHEDULE': '排程计算出错',
  'err.ERR_LOCK_HELD': '编辑权被他人持有',
  'err.ERR_LOCK_LOST': '编辑权已失效',
  'err.ERR_NO_LOCK': '未持有编辑权',
  'err.ERR_PLAN_NOT_FOUND': '计划不存在',
  'err.ERR_VERSION_NOT_FOUND': '版本不存在',
  'err.ERR_STALE_VERSION': '版本已过期，请刷新',
  'err.ERR_FEATURE_DISABLED': '本部署未启用该能力',
  'err.ERR_INTERNAL': '服务内部错误',

  /* —— 身份 / 登录（AuthGate） —— */
  'auth.appName': 'Project Planning with Checklist',
  'auth.connecting': '正在连接服务…',
  'auth.tabLogin': '登录',
  'auth.tabRegister': '注册',
  'auth.tabRegisterInvited': '注册（收到邀请）',
  'auth.loginHint': '用账号密码登录。如果是首次启动，请用部署时配置的 admin 账号登录。',
  'auth.username': '用户名',
  'auth.password': '密码',
  'auth.loginBtn': '登录',
  'auth.registerHint': '创建账号。检测到邀请链接，注册后会自动加入对应工作区。',
  'auth.registerHintPlain': '创建账号。无邀请码时会自动创建个人工作区。',
  'auth.inviteValid': '邀请有效 · 角色：{role} · 过期：{expires}',
  'auth.inviteInvalid': '邀请链接无效或已过期。仍可注册，会落到个人工作区。',
  'auth.usernameRule': '用户名（3-32 位小写字母/数字/_/-）',
  'auth.displayNameLabel': '显示名',
  'auth.displayNamePlaceholder': '团队里怎么叫你（默认 = 用户名）',
  'auth.passwordRule': '密码（至少 10 字符）',
  'auth.inviteCode': '邀请码（可选）',
  'auth.invitePlaceholder': '团队成员邀请链接里 ?invite= 后那段',
  'auth.registerBtn': '注册并登录',
  'auth.hello': '你好，{name}。选一个工作区继续：',
  'auth.unknownUser': '未知',
  'auth.current': '当前',
  'auth.memberCount': '{n} 人',
  'auth.emptyWorkspace': '空工作区',
  'auth.onlyOneWs': '只有 1 个工作区，自动进入。',
  'auth.manageTeam': '管理团队',
  'auth.logoutBtn': '注销',
  'auth.close': '关闭',
  'auth.err.invalidCredentials': '用户名或密码不正确',
  'auth.err.weakPassword': '密码至少 10 字符',
  'auth.err.usernameTaken': '用户名已被占用',
  'auth.err.authRequired': '请先登录',
  'auth.err.inviteInvalid': '邀请链接无效',
  'auth.err.inviteExpired': '邀请链接已过期',
  'auth.err.inviteConsumed': '邀请链接已被使用',
  'auth.err.workspaceForbidden': '无权限访问该工作区',
  'auth.err.unknown': '未知错误',
  'auth.err.code': '错误 {code}',

  /* —— 工具栏 —— */
  'toolbar.noPlan': '（未打开计划）',
  'toolbar.dirty': '未保存',
  'toolbar.userTooltipAuthed': '当前已登录，点击切换账号 / 工作区',
  'toolbar.userTooltipGuest': '点击登录',
  'toolbar.notLoggedIn': '未登录',
  'toolbar.rosterTooltip': '管理团队成员与邀请链接',
  'toolbar.team': '团队',
  'toolbar.logoutTooltip': '注销并清 cookie',
  'toolbar.logout': '注销',
  'toolbar.editingMe': '正在编辑（我）',
  'toolbar.editingBy': '{holder} 正在编辑',
  'toolbar.edit': '编辑',
  'toolbar.exitEdit': '{label} · 退出编辑',
  'toolbar.lockHeldBy': '编辑权由 {holder} 持有，30 秒无心跳后自动释放',
  'toolbar.lockHint': '同一时刻仅一人可编辑',
  'toolbar.saveTooltipError': '存在 error 级诊断，请先修复后再保存',
  'toolbar.saveTooltipNoEdit': '请先进入编辑模式',
  'toolbar.saveTooltipClean': '没有需要保存的修改',
  'toolbar.saveTooltipOk': '保存并生成新版本（变更纪要必填）',
  'toolbar.save': '保存',
  'toolbar.open': '打开',
  'toolbar.import': '导入',
  'toolbar.new': '新建',
  'toolbar.refresh': '刷新',
  'toolbar.export': '导出',
  'toolbar.exportCsvItem': 'CSV（Excel 可直接打开）',
  'toolbar.exportMd': 'Markdown 清单…',
  'toolbar.history': '变更记录',
  'toolbar.calendar': '日历设置',
  'toolbar.zoomDay': '日',
  'toolbar.zoomWeek': '周',
  'toolbar.zoomMonth': '月',
  'toolbar.today': '今天',
  'toolbar.langTooltip': 'Switch language / 切换语言',

  /* —— 对话框（Dialogs.tsx） —— */
  'dlg.notesLabel': '变更纪要（必填）',
  'dlg.notesHelper': '{n}/{max}　说明本次改了什么、为什么改，便于日后追溯',
  'dlg.notesPlaceholder': '例：联调依赖调整为 3FF+1w，上线日相应后移',
  'dlg.serverRejected': '服务端校验未通过，请先修复以下问题：',
  'dlg.openOrCreate': '打开或新建计划',
  'dlg.noPlans': '还没有任何计划，请先新建一个。',
  'dlg.rowCount': '{n} 行',
  'dlg.lastModified': '{time}　最后修改：{by}',
  'dlg.planName': '计划名称',
  'dlg.planNamePlaceholder': '例：2026 Q4 产品交付计划',
  'dlg.firstNotesLabel': '首版变更纪要（必填）',
  'dlg.skipHolidays': '排程跳过国定节假日（与调休补班）',
  'dlg.skipHolidaysHint': '开启后本计划按真实工作日历排程；关闭则每天都算工作日（仅周末视为非工作日）。',
  'dlg.newPlan': '新建计划',
  'dlg.create': '创建',
  'dlg.saveTitle': '保存并生成新版本',
  'dlg.saveBody': '将在服务端追加一条不可篡改的历史记录，预计生成 v{next}（最终版本号由服务端分配）。当前基线版本 v{cur}。',
  'dlg.historyTitle': '变更记录',
  'dlg.historyPlanSuffix': ' · {name}',
  'dlg.versionCount': '共 {n} 个版本',
  'dlg.historyHint': '回滚属于写操作，需先在工具栏获取编辑权；预览为只读操作，随时可用。',
  'dlg.noHistory': '暂无历史记录。',
  'dlg.current': '当前',
  'dlg.previewing': '预览中',
  'dlg.preview': '预览',
  'dlg.restoreAsNew': '回滚为新版本',
  'dlg.restoreNotesDefault': '回滚到 v{v}',
  'dlg.restoreBody': '将把 v{target} 的内容作为一个新版本追加到历史末尾（历史只增不改，原版本不会被删除）。预计生成 v{next}。',
  'dlg.restoreReasonLabel': '回滚原因（必填）',
  'dlg.confirmRestore': '确认回滚',
  'dlg.nonWorkTitle': '非工作日提示',
  'dlg.nonWorkBody': '你填写的{field}日期 {date} 为 {display}，并非工作日（周末或法定假日）。确认仍用，还是顺延到下一工作日？',
  'dlg.weekend': '周末',
  'dlg.deferToNext': '顺延到下一工作日（{d}）',
  'dlg.keepDate': '仍用该日',
  'dlg.calendarTitle': '工作日历设置',
  'dlg.calendarHint': '维护自定义节假日 / 补班日 / 移除的官方假日（按年份）。保存前会自动获取全局日历编辑锁。',
  'dlg.addCurrentYear': '+ 当前年',
  'dlg.userHolidays': '自定义节假日（userHolidays）',
  'dlg.makeupDays': '补班日（makeup）',
  'dlg.userRemoved': '移除的官方假日（userRemoved）',
  'dlg.emptyList': '（空）',
  'dlg.saving': '保存中…',

  /* —— 排程字段来源（与 shared/types DERIVE_SOURCE_LABEL 的 zh 完全一致） —— */
  'derive.INPUT': '手动输入',
  'derive.DEP': '由依赖关系推算',
  'derive.ROLLUP': '由子任务汇总',
  'derive.ANCHOR': '由默认锚点日期推算',
  'derive.MIXED': '由其它已填字段推算',
  'derive.parentTip': '由子任务汇总，不可手填',

  /* —— 任务表格 —— */
  'task.clickToSet': '点击设置{field}',
  'task.clickToSetCur': '点击设置{field}（当前：{current}）',
  'task.typeToSelect': '输入或选择{field}',
  'task.keepAdding': '继续添加…',
  'task.addFreePrefix': '添加',
  'task.expandChildren': '展开子任务',
  'task.collapseChildren': '折叠子任务',
  'task.placeholderName': '任务名称',
  'task.pickDate': '选择日期',
  'task.depsHint': '填前置任务行号：3 / 2FS / 3FF+1w / 7ss-3d，多条用逗号分隔',
  'task.insertBelow': '在下方插入同级行（Enter）',
  'task.clearFilterFirst': '请先清除筛选，再插入新行',
  'task.indent': '缩进为上一行的子任务',
  'task.outdent': '升级一层',
  'task.moveUp': '上移',
  'task.moveDown': '下移',
  'task.deleteRow': '删除该行',
  'task.deleteWithChildren': '删除该行及其所有子任务',
  'task.addRow': '新增一行',
  'task.resizeHint': '拖动调整列宽；双击按内容自适应',
  'task.editModeFooter': '编辑模式：改完记得点工具栏「保存」',
  'task.readonlyModeFooter': '只读模式：点击工具栏「编辑」获取编辑权后方可修改',

  /* —— 筛选（filter.ts 摘要与 FilterBar / ColumnFilterMenu UI） —— */
  'filter.opContains': '包含',
  'filter.opNotContains': '不包含',
  'filter.opStartsWith': '开头是',
  'filter.opEquals': '等于',
  'filter.opBefore': '早于',
  'filter.opOnOrAfter': '不早于',
  'filter.opBetween': '介于（含两端）',
  'filter.blankLabel': '(空白)',
  'filter.sep': '；',
  'filter.enumSep': '、',
  'filter.descTextEmpty': '{label}：{op}…',
  'filter.descText': '{label}：{op}「{v}」',
  'filter.descDateBetween': '{label}：{from} ~ {to}',
  'filter.descDateOp': '{label}：{op} {from}',
  'filter.descEnumBlanksOnly': '{label}：仅空值',
  'filter.descEnumNone': '{label}：（无）',
  'filter.descEnumMore': ' 等 {n} 项',
  'filter.descEnumBlank': ' + 空值',
  'filter.descEnum': '{label}：{shown}{more}{blank}',
  'filter.noFilter': '未筛选',
  'filter.activePrefix': '筛选：',
  'filter.summaryOnlyMine': '仅「{me}」相关的行',
  'filter.summaryNoIdentity': '未选择身份',
  'filter.assignToMe': 'Assign to me',
  'filter.onlyMineTip': '只显示负责人或顾问人是「{me}」的行（含其父任务）',
  'filter.onlyMineTipNoId': '请先在工具栏「选择身份」后再使用',
  'filter.showingRows': '显示 {shown} / 共 {total} 行',
  'filter.clearAllTip': '清除全部筛选条件',
  'filter.clearAll': '清除全部',
  'filter.searchPlaceholder': '搜索',
  'filter.selectAll': '（全选）',
  'filter.noMatch': '无匹配值',
  'filter.textTitle': '显示名称{op}：',
  'filter.keywordPlaceholder': '关键词',
  'filter.textHint': '留空 = 该列不筛选',
  'filter.dateTo': '至',
  'filter.dateHint': '空日期的行不参与日期筛选',
  'filter.menuActive': '已筛选「{label}」，点击修改',
  'filter.menuIdle': '筛选「{label}」',
  'filter.menuAria': '筛选{label}',
  'filter.clearColumn': '清除本列',

  /* —— 月历弹窗（DatePickerPopover） —— */
  'cal.weekLabels': '日,一,二,三,四,五,六',
  'cal.monthTitle': '{y} 年 {m} 月',
  'cal.nonWorking': '非工作日',
  'cal.weekend': '周末',

  /* —— TODO 抽屉 —— */
  'todo.unnamedTask': '未命名任务',
  'todo.headerNone': 'TODO 交付清单 · 暂无',
  'todo.headerProgress': 'TODO 交付清单 · {done}/{total} 已完成',
  'todo.closeAria': '关闭 TODO 抽屉',
  'todo.emptyHint': '还没有 TODO 项，在下方输入第一条交付成果。',
  'todo.assigneePlaceholder': '负责人（可选）',
  'todo.markDoneAria': '标记「{text}」完成',
  'todo.moveUpAria': '上移 TODO「{text}」',
  'todo.moveDownAria': '下移 TODO「{text}」',
  'todo.deleteAria': '删除 TODO「{text}」',
  'todo.addInputEdit': '添加一项交付成果，回车确认',
  'todo.addInputPreview': '预览模式不可添加',
  'todo.addBtn': '添加',
  'todo.emptyAdd': '暂无 TODO，点击添加',
  'todo.progressTitle': 'TODO {done}/{total}，点击查看 / 编辑',
  'todo.progressAria': 'TODO {done}/{total}，点击查看或编辑',

  /* —— 甘特图 —— */
  'gantt.yearLabel': '{y} 年',
  'gantt.yearMonthLabel': '{y} 年 {m} 月',
  'gantt.month': '{m}月',
  'gantt.holiday': '节假日',
  'gantt.makeup': '补班',
  'gantt.unnamed': '（未命名）',
  'gantt.range': '区间：{start} → {end}（半开，不含结束日）',
  'gantt.durationSrc': '时长：{dur}　来源：{src}',
  'gantt.parentSummary': '父任务：时间由子任务汇总',
  'gantt.legendTask': '任务',
  'gantt.legendSummary': '父任务汇总',
  'gantt.legendConflict': '依赖冲突',
  'gantt.legendHoliday': '法定假日',
  'gantt.legendMakeup': '补班日',
  'gantt.legendWeekend': '周末',
  'gantt.legendRange': '条形区间为 [开始, 结束)，结束日不占用工期',

  /* —— 花名册 —— */
  'roster.title': '团队花名册',
  'roster.subtitle': '人员候选的唯一来源：当前工作区成员（邀请制）',
  'roster.member': '成员',
  'roster.displayName': '显示名',
  'roster.username': '用户名',
  'roster.role': '角色',
  'roster.joinedAt': '加入时间',
  'roster.invite': '邀请成员',
  'roster.invitePlaceholder': '对方用户名',
  'roster.inviteRole': '以角色邀请',
  'roster.inviteGenerate': '生成邀请链接',
  'roster.inviteCopied': '邀请链接已复制，发给对方即可',
  'roster.remove': '移除',
  'roster.removeConfirm': '确定把 {name} 移出工作区？',
  'roster.changeRole': '修改角色',
  'roster.empty': '工作区还没有其他成员',
  'roster.you': '（你）',
  'roster.inviteHint': '邀请链接一次性有效，对方注册后自动加入',

  /* —— 导出 Markdown —— */
  'exportMd.title': '导出 Markdown TODO 清单',
  'exportMd.desc': '选择导出范围。生成 Markdown 文件，包含任务元信息与每条 todo（[x]/[ ] + 文本 + 责任人）。',
  'exportMd.mine': '仅与我相关',
  'exportMd.noIdentity': '未选身份',
  'exportMd.allLabel': '全部（所有任务 + 全部 TODO + 责任人）',
  'exportMd.needIdentity': '「仅与我相关」需要先选择身份（工具栏「选择身份」处登录）。',
  'exportMd.download': '下载',

  /* —— ErrorBoundary —— */
  'errorBoundary.title': '界面出现渲染错误（数据未丢失）',
  'errorBoundary.desc': '提示：计划数据仍在内存中，点「重试」即可恢复编辑；若反复出现，请把上方错误信息反馈给开发。',
  'errorBoundary.retry': '重试恢复界面',

  /* —— 启动 —— */
  'boot.noRoot': '未找到 #root 挂载点',

  /* —— Toast / Snackbar（store.ts） —— */
  'toast.lockLostRecycle': '编辑权已被回收，未保存的修改请复制备份后重新进入编辑模式',
  'toast.loadCalendarFail': '读取工作日历失败：{msg}',
  'toast.probeSessionFail': '探测登录态失败：{msg}',
  'toast.loadWorkspacesFail': '读取工作区列表失败：{msg}',
  'toast.loadPlansFail': '读取计划列表失败：{msg}',
  'toast.openPlanFail': '打开计划失败：{msg}',
  'toast.pickIdentityFirst': '请先选择身份',
  'toast.planCreated': '计划「{name}」已创建（v{v}）',
  'toast.createPlanFail': '新建计划失败：{msg}',
  'toast.fileReadFail': '文件读取失败',
  'toast.imported': '已导入「{name}」（v{v}）',
  'toast.mppDisabled': '本部署未启用 MPP 导入（本机需运行 server/mpxj/fetch-mpxj.sh 后重启服务）',
  'toast.importFail': '导入失败：{msg}',
  'toast.refreshFail': '刷新失败：{msg}',
  'toast.scheduleError': '排程计算出错：{msg}',
  'toast.calendarSaved': '工作日历已保存',
  'toast.saveCalendarFail': '保存工作日历失败：{msg}',
  'toast.deletedRows': '已删除 {n} 行{extra}',
  'toast.deletedDepsExtra': '，同时清理了 {n} 条指向它的依赖',
  'toast.indentFirst': '已是本层第一行，无法缩进',
  'toast.outdentTop': '已是顶层，无法升级',
  'toast.moveBoundary': '已到边界，无法移动',
  'toast.exitPreviewFirst': '请先退出版本预览',
  'toast.editModeOn': '已进入编辑模式',
  'toast.holderFallback': '他人',
  'toast.editingByOther': '「{holder}」正在编辑，暂时无法获取编辑权',
  'toast.acquireLockFail': '获取编辑权失败：{msg}',
  'toast.editModeFirst': '请先进入编辑模式',
  'toast.savedAs': '已保存为 v{v}',
  'toast.saveBlocked': '存在阻断性错误，保存被拒绝',
  'toast.lockLostOnSave': '编辑权已失效，保存失败。请重新进入编辑模式后再次保存',
  'toast.staleVersion': '服务端已有更新版本，请刷新后重做本次修改',
  'toast.saveFail': '保存失败：{msg}',
  'toast.loadHistoryFail': '读取变更记录失败：{msg}',
  'toast.dirtyBeforePreview': '有未保存的修改，请先保存或刷新后再预览历史版本',
  'toast.previewFail': '预览版本失败：{msg}',
  'toast.restoreNeedEdit': '回滚属于写操作，请先进入编辑模式',
  'toast.restored': '已回滚 v{from}，生成新版本 v{to}',
  'toast.lockLostOnRestore': '编辑权已失效，回滚失败',
  'toast.restoreFail': '回滚失败：{msg}',
  'toast.exportStale': '导出使用服务端最新版本，当前有未保存修改不会包含在内',
  'toast.needIdentityToExport': '未选择身份，无法导出「仅与我相关」',
  'toast.addTodoFail': '添加 TODO 失败：{msg}',
  'toast.updateTodoFail': '更新 TODO 失败：{msg}',
  'toast.deleteTodoFail': '删除 TODO 失败：{msg}',
  'toast.moveTodoFail': '移动 TODO 失败：{msg}',

  /* —— API 层错误 —— */
  'err.networkFail': '网络请求失败：{msg}',
  'err.badResponse': '服务响应异常（HTTP {status}）',
};

const en: Record<string, string> = {
  /* —— Common —— */
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.loading': 'Loading…',
  'common.none': 'None',
  'common.all': 'All',
  'common.search': 'Search',
  'common.confirm': 'Confirm',
  'common.reset': 'Reset',
  'common.retry': 'Retry',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.row': 'Row',

  /* —— Columns —— */
  'col.seq': '#',
  'col.name': 'Task Name',
  'col.start': 'Start',
  'col.end': 'End',
  'col.duration': 'Duration',
  'col.deps': 'Deps',
  'col.owner': 'Owner',
  'col.consultant': 'Consultant',
  'col.todo': 'TODO',
  'col.actions': 'Actions',

  /* —— Diagnostics / banners —— */
  'diag.errors': '{n} error(s)',
  'diag.warns': '{n} warning(s)',
  'diag.hint': '(errors block saving; click to locate the row)',
  'diag.collapse': 'Collapse',
  'diag.expand': 'Expand',
  'diag.rowN': 'Row {seq}',
  'banner.calendarOk': 'Work calendar active (years {years})',
  'banner.calendarWarn': 'Year {year} not covered by the calendar; fell back to weekends-only',
  'empty.title': 'No plan open yet',
  'empty.openPlan': 'Open / New Plan',
  'empty.pickUserFirst': 'Pick your identity first',
  'preview.banner': 'Previewing v{version} (read-only)',
  'preview.by': 'By {editor}: {notes}',
  'preview.exit': 'Exit Preview',

  /* —— Error codes —— */
  'err.ERR_VALIDATION': 'Validation failed',
  'err.ERR_NOTES_REQUIRED': 'Change notes required',
  'err.ERR_OVER_CONSTRAINED': 'Over-constrained (fill at most 2 of start/end/duration)',
  'err.ERR_CYCLE': 'Circular dependency',
  'err.ERR_DEP_PARSE': 'Invalid dependency expression',
  'err.WARN_DEP_CONFLICT': 'Conflicts with dependencies',
  'err.ERR_INVALID_DATE': 'Invalid date',
  'err.ERR_DURATION_PARSE': 'Invalid duration',
  'err.ERR_DEP_TARGET_MISSING': 'Dependent row not found',
  'err.ERR_DEP_SELF': 'Cannot depend on itself',
  'err.ERR_DEP_ANCESTOR': 'Cannot depend on its own ancestor/descendant',
  'err.WARN_PARENT_DEP_IGNORED': 'Parent task dependency ignored',
  'err.ERR_NEGATIVE_DURATION': 'End cannot precede start',
  'err.ERR_PARENT_CYCLE': 'Parent-child hierarchy cycle',
  'err.WARN_PARENT_INPUT_IGNORED': 'Parent task manual timing ignored',
  'err.WARN_UNSCHEDULED': 'Unconstrained; placed at anchor date',
  'err.WARN_DURATION_DEFAULTED': 'Duration defaulted to 1d',
  'err.WARN_REDUNDANT_INPUT': 'All three filled and consistent',
  'err.ERR_SCHEDULE': 'Scheduling error',
  'err.ERR_LOCK_HELD': 'Edit lock held by someone else',
  'err.ERR_LOCK_LOST': 'Edit lock lost',
  'err.ERR_NO_LOCK': 'No edit lock held',
  'err.ERR_PLAN_NOT_FOUND': 'Plan not found',
  'err.ERR_VERSION_NOT_FOUND': 'Version not found',
  'err.ERR_STALE_VERSION': 'Version stale, please refresh',
  'err.ERR_FEATURE_DISABLED': 'Feature not enabled in this deployment',
  'err.ERR_INTERNAL': 'Internal server error',

  /* —— Auth —— */
  'auth.appName': 'Project Planning with Checklist',
  'auth.connecting': 'Connecting to server…',
  'auth.tabLogin': 'Sign In',
  'auth.tabRegister': 'Sign Up',
  'auth.tabRegisterInvited': 'Sign Up (invited)',
  'auth.loginHint': 'Sign in with username and password. On first launch, use the admin account configured at deployment.',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.loginBtn': 'Sign In',
  'auth.registerHint': 'Create an account. Invite link detected — you will join the workspace automatically.',
  'auth.registerHintPlain': 'Create an account. Without an invite code, a personal workspace is created for you.',
  'auth.inviteValid': 'Invite valid · role: {role} · expires: {expires}',
  'auth.inviteInvalid': 'Invite link invalid or expired. You can still sign up into a personal workspace.',
  'auth.usernameRule': 'Username (3-32 chars: lowercase/digits/_/-)',
  'auth.displayNameLabel': 'Display name',
  'auth.displayNamePlaceholder': 'How the team calls you (default = username)',
  'auth.passwordRule': 'Password (min 10 chars)',
  'auth.inviteCode': 'Invite code (optional)',
  'auth.invitePlaceholder': 'The part after ?invite= in the invite link',
  'auth.registerBtn': 'Sign Up & In',
  'auth.hello': 'Hi, {name}. Pick a workspace to continue:',
  'auth.unknownUser': 'unknown',
  'auth.current': 'current',
  'auth.memberCount': '{n} member(s)',
  'auth.emptyWorkspace': 'empty workspace',
  'auth.onlyOneWs': 'Only one workspace; entered automatically.',
  'auth.manageTeam': 'Manage Team',
  'auth.logoutBtn': 'Sign Out',
  'auth.close': 'Close',
  'auth.err.invalidCredentials': 'Incorrect username or password',
  'auth.err.weakPassword': 'Password must be at least 10 characters',
  'auth.err.usernameTaken': 'Username already taken',
  'auth.err.authRequired': 'Please sign in first',
  'auth.err.inviteInvalid': 'Invite link invalid',
  'auth.err.inviteExpired': 'Invite link expired',
  'auth.err.inviteConsumed': 'Invite link already used',
  'auth.err.workspaceForbidden': 'No access to that workspace',
  'auth.err.unknown': 'Unknown error',
  'auth.err.code': 'Error {code}',

  /* —— Toolbar —— */
  'toolbar.noPlan': '(no plan open)',
  'toolbar.dirty': 'Unsaved',
  'toolbar.userTooltipAuthed': 'Signed in — click to switch account / workspace',
  'toolbar.userTooltipGuest': 'Click to sign in',
  'toolbar.notLoggedIn': 'Not signed in',
  'toolbar.rosterTooltip': 'Manage team members and invite links',
  'toolbar.team': 'Team',
  'toolbar.logoutTooltip': 'Sign out and clear cookies',
  'toolbar.logout': 'Sign Out',
  'toolbar.editingMe': 'Editing (me)',
  'toolbar.editingBy': '{holder} is editing',
  'toolbar.edit': 'Edit',
  'toolbar.exitEdit': '{label} · Exit Edit',
  'toolbar.lockHeldBy': 'Edit lock held by {holder}; auto-released after 30s without heartbeat',
  'toolbar.lockHint': 'Only one editor at a time',
  'toolbar.saveTooltipError': 'Fix the error-level diagnostics before saving',
  'toolbar.saveTooltipNoEdit': 'Enter edit mode first',
  'toolbar.saveTooltipClean': 'Nothing to save',
  'toolbar.saveTooltipOk': 'Save as a new version (change notes required)',
  'toolbar.save': 'Save',
  'toolbar.open': 'Open',
  'toolbar.import': 'Import',
  'toolbar.new': 'New',
  'toolbar.refresh': 'Refresh',
  'toolbar.export': 'Export',
  'toolbar.exportCsvItem': 'CSV (opens in Excel)',
  'toolbar.exportMd': 'Markdown Checklist…',
  'toolbar.history': 'History',
  'toolbar.calendar': 'Calendar',
  'toolbar.zoomDay': 'D',
  'toolbar.zoomWeek': 'W',
  'toolbar.zoomMonth': 'M',
  'toolbar.today': 'Today',
  'toolbar.langTooltip': '切换语言 / Switch language',

  /* —— Dialogs —— */
  'dlg.notesLabel': 'Change notes (required)',
  'dlg.notesHelper': '{n}/{max}  What changed and why — for future reference',
  'dlg.notesPlaceholder': 'e.g. adjusted integration deps to 3FF+1w; launch moved accordingly',
  'dlg.serverRejected': 'Server validation failed. Fix the following first:',
  'dlg.openOrCreate': 'Open or Create Plan',
  'dlg.noPlans': 'No plans yet — create one first.',
  'dlg.rowCount': '{n} rows',
  'dlg.lastModified': '{time}  last modified by {by}',
  'dlg.planName': 'Plan name',
  'dlg.planNamePlaceholder': 'e.g. 2026 Q4 Product Delivery',
  'dlg.firstNotesLabel': 'First-version notes (required)',
  'dlg.skipHolidays': 'Skip public holidays (incl. makeup workdays)',
  'dlg.skipHolidaysHint': 'On: schedule on the real work calendar. Off: every day counts as a workday (weekends excluded).',
  'dlg.newPlan': 'New Plan',
  'dlg.create': 'Create',
  'dlg.saveTitle': 'Save as New Version',
  'dlg.saveBody': 'An immutable history record will be appended; expected v{next} (final number assigned by the server). Current baseline v{cur}.',
  'dlg.historyTitle': 'History',
  'dlg.historyPlanSuffix': ' · {name}',
  'dlg.versionCount': '{n} version(s)',
  'dlg.historyHint': 'Restoring is a write — acquire the edit lock in the toolbar first. Previewing is read-only.',
  'dlg.noHistory': 'No history yet.',
  'dlg.current': 'current',
  'dlg.previewing': 'previewing',
  'dlg.preview': 'Preview',
  'dlg.restoreAsNew': 'Restore as New Version',
  'dlg.restoreNotesDefault': 'Restore to v{v}',
  'dlg.restoreBody': 'The content of v{target} will be appended as a NEW version (history is append-only; the original is never deleted). Expected v{next}.',
  'dlg.restoreReasonLabel': 'Restore reason (required)',
  'dlg.confirmRestore': 'Restore',
  'dlg.nonWorkTitle': 'Non-working Day',
  'dlg.nonWorkBody': 'The {field} date {date} falls on {display}, which is not a working day (weekend or public holiday). Keep it, or defer to the next working day?',
  'dlg.weekend': 'weekend',
  'dlg.deferToNext': 'Defer to next working day ({d})',
  'dlg.keepDate': 'Keep this date',
  'dlg.calendarTitle': 'Work Calendar Settings',
  'dlg.calendarHint': 'Manage custom holidays / makeup workdays / removed official holidays (per year). The global calendar edit lock is acquired before saving.',
  'dlg.addCurrentYear': '+ current year',
  'dlg.userHolidays': 'Custom holidays (userHolidays)',
  'dlg.makeupDays': 'Makeup workdays (makeup)',
  'dlg.userRemoved': 'Removed official holidays (userRemoved)',
  'dlg.emptyList': '(empty)',
  'dlg.saving': 'Saving…',

  /* —— Derive sources —— */
  'derive.INPUT': 'Manual input',
  'derive.DEP': 'Derived from dependencies',
  'derive.ROLLUP': 'Rolled up from subtasks',
  'derive.ANCHOR': 'Derived from the default anchor date',
  'derive.MIXED': 'Derived from other filled fields',
  'derive.parentTip': 'Rolled up from subtasks; cannot be entered manually',

  /* —— Task table —— */
  'task.clickToSet': 'Click to set {field}',
  'task.clickToSetCur': 'Click to set {field} (current: {current})',
  'task.typeToSelect': 'Type or select {field}',
  'task.keepAdding': 'Keep adding…',
  'task.addFreePrefix': 'Add',
  'task.expandChildren': 'Expand subtasks',
  'task.collapseChildren': 'Collapse subtasks',
  'task.placeholderName': 'Task name',
  'task.pickDate': 'Pick a date',
  'task.depsHint': 'Enter predecessor rows: 3 / 2FS / 3FF+1w / 7ss-3d, comma-separated',
  'task.insertBelow': 'Insert a sibling row below (Enter)',
  'task.clearFilterFirst': 'Clear the filter before inserting a new row',
  'task.indent': 'Indent as a child of the row above',
  'task.outdent': 'Outdent one level',
  'task.moveUp': 'Move up',
  'task.moveDown': 'Move down',
  'task.deleteRow': 'Delete this row',
  'task.deleteWithChildren': 'Delete this row and all its subtasks',
  'task.addRow': 'Add a row',
  'task.resizeHint': 'Drag to resize; double-click to autofit',
  'task.editModeFooter': 'Edit mode: remember to click Save in the toolbar',
  'task.readonlyModeFooter': 'Read-only mode: click Edit in the toolbar to acquire the edit lock first',

  /* —— Filter —— */
  'filter.opContains': 'Contains',
  'filter.opNotContains': 'Does not contain',
  'filter.opStartsWith': 'Starts with',
  'filter.opEquals': 'Equals',
  'filter.opBefore': 'Before',
  'filter.opOnOrAfter': 'On or after',
  'filter.opBetween': 'Between (inclusive)',
  'filter.blankLabel': '(Blanks)',
  'filter.sep': '; ',
  'filter.enumSep': ', ',
  'filter.descTextEmpty': '{label}: {op}…',
  'filter.descText': '{label}: {op} "{v}"',
  'filter.descDateBetween': '{label}: {from} ~ {to}',
  'filter.descDateOp': '{label}: {op} {from}',
  'filter.descEnumBlanksOnly': '{label}: blanks only',
  'filter.descEnumNone': '{label}: (none)',
  'filter.descEnumMore': ' +{n} more',
  'filter.descEnumBlank': ' + blanks',
  'filter.descEnum': '{label}: {shown}{more}{blank}',
  'filter.noFilter': 'No filter',
  'filter.activePrefix': 'Filter: ',
  'filter.summaryOnlyMine': 'Rows related to "{me}"',
  'filter.summaryNoIdentity': 'no identity selected',
  'filter.assignToMe': 'Assign to me',
  'filter.onlyMineTip': 'Show only rows where {me} is owner or consultant (parents kept)',
  'filter.onlyMineTipNoId': 'Sign in via the toolbar identity button first',
  'filter.showingRows': 'Showing {shown} / {total} rows',
  'filter.clearAllTip': 'Clear all filters',
  'filter.clearAll': 'Clear All',
  'filter.searchPlaceholder': 'Search',
  'filter.selectAll': '(Select all)',
  'filter.noMatch': 'No matching values',
  'filter.textTitle': 'Show name {op}:',
  'filter.keywordPlaceholder': 'Keyword',
  'filter.textHint': 'Empty = no filter on this column',
  'filter.dateTo': 'to',
  'filter.dateHint': 'Rows with empty dates are excluded from date filters',
  'filter.menuActive': '"{label}" filtered — click to modify',
  'filter.menuIdle': 'Filter "{label}"',
  'filter.menuAria': 'Filter {label}',
  'filter.clearColumn': 'Clear this column',

  /* —— Month picker (DatePickerPopover) —— */
  'cal.weekLabels': 'Sun,Mon,Tue,Wed,Thu,Fri,Sat',
  'cal.monthTitle': '{y}-{m}',
  'cal.nonWorking': 'Non-working day',
  'cal.weekend': 'Weekend',

  /* —— TODO drawer —— */
  'todo.unnamedTask': 'Unnamed task',
  'todo.headerNone': 'TODO checklist · none yet',
  'todo.headerProgress': 'TODO checklist · {done}/{total} done',
  'todo.closeAria': 'Close TODO drawer',
  'todo.emptyHint': 'No TODOs yet — type the first deliverable below.',
  'todo.assigneePlaceholder': 'Owner (optional)',
  'todo.markDoneAria': 'Mark "{text}" as done',
  'todo.moveUpAria': 'Move TODO "{text}" up',
  'todo.moveDownAria': 'Move TODO "{text}" down',
  'todo.deleteAria': 'Delete TODO "{text}"',
  'todo.addInputEdit': 'Add a deliverable (Enter to confirm)',
  'todo.addInputPreview': 'Read-only preview — cannot add',
  'todo.addBtn': 'Add',
  'todo.emptyAdd': 'No TODOs yet — click to add',
  'todo.progressTitle': 'TODO {done}/{total} — click to view / edit',
  'todo.progressAria': 'TODO {done}/{total} — click to view or edit',

  /* —— Gantt —— */
  'gantt.yearLabel': '{y}',
  'gantt.yearMonthLabel': '{y}-{m}',
  'gantt.month': '{m}',
  'gantt.holiday': 'Holiday',
  'gantt.makeup': 'Makeup workday',
  'gantt.unnamed': '(unnamed)',
  'gantt.range': 'Range: {start} → {end} (half-open, end exclusive)',
  'gantt.durationSrc': 'Duration: {dur}  Source: {src}',
  'gantt.parentSummary': 'Parent: timing rolled up from subtasks',
  'gantt.legendTask': 'Task',
  'gantt.legendSummary': 'Parent rollup',
  'gantt.legendConflict': 'Dependency conflict',
  'gantt.legendHoliday': 'Public holiday',
  'gantt.legendMakeup': 'Makeup workday',
  'gantt.legendWeekend': 'Weekend',
  'gantt.legendRange': 'Bars cover [start, end); the end day costs no work',

  /* —— Roster —— */
  'roster.title': 'Team Roster',
  'roster.subtitle': 'The single source of people candidates: workspace members (invite-only)',
  'roster.member': 'Member',
  'roster.displayName': 'Display name',
  'roster.username': 'Username',
  'roster.role': 'Role',
  'roster.joinedAt': 'Joined',
  'roster.invite': 'Invite Member',
  'roster.invitePlaceholder': "Invitee's username",
  'roster.inviteRole': 'Invite as',
  'roster.inviteGenerate': 'Generate Invite Link',
  'roster.inviteCopied': 'Invite link copied — send it to them',
  'roster.remove': 'Remove',
  'roster.removeConfirm': 'Remove {name} from this workspace?',
  'roster.changeRole': 'Change role',
  'roster.empty': 'No other members yet',
  'roster.you': '(you)',
  'roster.inviteHint': 'Invite links are one-time; the invitee joins automatically after sign-up',

  /* —— Export Markdown —— */
  'exportMd.title': 'Export Markdown TODO Checklist',
  'exportMd.desc': 'Choose the scope. Generates a Markdown file with task metadata and each todo ([x]/[ ] + text + assignee).',
  'exportMd.mine': 'Mine only',
  'exportMd.noIdentity': 'no identity selected',
  'exportMd.allLabel': 'All (every task + all TODOs + assignees)',
  'exportMd.needIdentity': '"Mine only" requires signing in first (via the identity button in the toolbar).',
  'exportMd.download': 'Download',

  /* —— ErrorBoundary —— */
  'errorBoundary.title': 'The UI hit a rendering error (data is safe)',
  'errorBoundary.desc': 'Plan data is still in memory — click Retry to resume editing. If this keeps happening, send the error above to the developer.',
  'errorBoundary.retry': 'Retry',

  /* —— Boot —— */
  'boot.noRoot': '#root mount point not found',

  /* —— Toast / Snackbar (store.ts) —— */
  'toast.lockLostRecycle': 'Edit lock was revoked — copy your unsaved changes, then re-enter edit mode',
  'toast.loadCalendarFail': 'Failed to load the work calendar: {msg}',
  'toast.probeSessionFail': 'Failed to probe session: {msg}',
  'toast.loadWorkspacesFail': 'Failed to load workspaces: {msg}',
  'toast.loadPlansFail': 'Failed to load plans: {msg}',
  'toast.openPlanFail': 'Failed to open the plan: {msg}',
  'toast.pickIdentityFirst': 'Pick your identity first',
  'toast.planCreated': 'Plan "{name}" created (v{v})',
  'toast.createPlanFail': 'Failed to create the plan: {msg}',
  'toast.fileReadFail': 'Failed to read the file',
  'toast.imported': 'Imported "{name}" (v{v})',
  'toast.mppDisabled': 'MPP import is not enabled in this deployment (run server/mpxj/fetch-mpxj.sh on the server host and restart)',
  'toast.importFail': 'Import failed: {msg}',
  'toast.refreshFail': 'Refresh failed: {msg}',
  'toast.scheduleError': 'Scheduling error: {msg}',
  'toast.calendarSaved': 'Work calendar saved',
  'toast.saveCalendarFail': 'Failed to save the work calendar: {msg}',
  'toast.deletedRows': 'Deleted {n} row(s){extra}',
  'toast.deletedDepsExtra': ' (also cleared {n} dependency link(s) pointing to them)',
  'toast.indentFirst': 'Already the first row of its level — cannot indent',
  'toast.outdentTop': 'Already top-level — cannot outdent',
  'toast.moveBoundary': 'Already at the boundary — cannot move',
  'toast.exitPreviewFirst': 'Exit version preview first',
  'toast.editModeOn': 'Edit mode on',
  'toast.holderFallback': 'someone else',
  'toast.editingByOther': '"{holder}" is editing — cannot acquire the edit lock yet',
  'toast.acquireLockFail': 'Failed to acquire the edit lock: {msg}',
  'toast.editModeFirst': 'Enter edit mode first',
  'toast.savedAs': 'Saved as v{v}',
  'toast.saveBlocked': 'Blocking errors — save rejected',
  'toast.lockLostOnSave': 'Edit lock lost; save failed. Re-enter edit mode and save again',
  'toast.staleVersion': 'The server has a newer version — refresh and redo your changes',
  'toast.saveFail': 'Save failed: {msg}',
  'toast.loadHistoryFail': 'Failed to load history: {msg}',
  'toast.dirtyBeforePreview': 'You have unsaved changes — save or refresh before previewing a version',
  'toast.previewFail': 'Failed to preview the version: {msg}',
  'toast.restoreNeedEdit': 'Restoring is a write — enter edit mode first',
  'toast.restored': 'Restored v{from} as new version v{to}',
  'toast.lockLostOnRestore': 'Edit lock lost; restore failed',
  'toast.restoreFail': 'Restore failed: {msg}',
  'toast.exportStale': 'Exports use the latest server version; unsaved local changes are not included',
  'toast.needIdentityToExport': 'No identity selected — cannot export "Mine only"',
  'toast.addTodoFail': 'Failed to add the TODO: {msg}',
  'toast.updateTodoFail': 'Failed to update the TODO: {msg}',
  'toast.deleteTodoFail': 'Failed to delete the TODO: {msg}',
  'toast.moveTodoFail': 'Failed to move the TODO: {msg}',

  /* —— API layer errors —— */
  'err.networkFail': 'Network request failed: {msg}',
  'err.badResponse': 'Bad server response (HTTP {status})',
};

/* ============================ 核心 API ============================ */

/**
 * 翻译函数（纯函数，读当前快照）。
 * 查找顺序：当前语言字典 → zh 字典 → 键本身。
 * vars 用 {name} 占位符插值。
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = useLangStore.getState().lang;
  const dict = lang === 'en' ? en : zh;
  let text = dict[key] ?? zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}

/**
 * 组件内使用的 hook：订阅 lang 变化，切语言时自动重渲染。
 * 返回的 t 与纯函数版签名一致。
 */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  useLangStore((s) => s.lang); // 订阅，保证语言切换触发重渲染
  return t;
}

/** 语言切换按钮用的标签 */
export function langLabel(lang: Lang): string {
  return lang === 'zh' ? 'EN' : '中文';
}

/* —— 错误码 → 本地化短名 —— */

/** code(数字) → 枚举名 的反查表（构建一次） */
const ERR_NAME_BY_CODE: Map<number, string> = new Map(
  (Object.entries(ErrCode) as [string, number][]).map(([name, code]) => [code, name]),
);

/**
 * 诊断条 / Snackbar 用的错误码短名：
 * 先查 i18n 字典（err.<枚举名>），缺键回退 shared/types 的中文 ERR_CODE_LABEL。
 */
export function errLabel(code: number): string {
  const name = ERR_NAME_BY_CODE.get(code);
  if (name) {
    const dict = useLangStore.getState().lang === 'en' ? en : zh;
    const hit = dict[`err.${name}`];
    if (hit) return hit;
  }
  return ERR_CODE_LABEL[code] ?? '';
}

/* —— 排程字段来源 → 本地化标签 —— */

/**
 * DERIVE_SOURCE_LABEL（shared/types，写死中文）的 i18n 版。
 * 键 = DeriveSource 枚举值（INPUT/DEP/ROLLUP/ANCHOR/MIXED）；
 * 缺键返回键本身（与 t() 的漏翻可见策略一致）。
 */
export function deriveLabel(src: string): string {
  return t(`derive.${src}`);
}
