/**
 * MppImport —— MPXJ 桥接（仅本机 Mac/Linux + Java 环境）。
 *
 * 职责边界：只做「读文件 → 结构化中间 JSON」，业务映射全在 TS 侧（server/mppImport.ts）。
 * 由 fetch-mpxj.sh 下载依赖并编译为 MppImport.class。
 *
 * 中间 JSON 契约（单一真源，与 server/mppImport.ts 顶部注释一致）：
 *   { name, tasks: [{ uid, name, start, finish, parentUid, owner, note, progress,
 *                     predecessors: [{ uid, type, lagText }] }] }
 *   - start / finish 为 yyyy-MM-dd；finish 为 MPP 的含内结束日（inclusive）
 *   - type ∈ FS | SS | FF | SF
 *   - lagText 形如 "2d" / "-1w" / "3m"（server 侧 parseLag 只接受整数 + d/w/m）
 *
 * 用法：java -cp "<mpxj目录>:<mpxj目录>/lib/*" MppImport <file>
 * 退出码：0 成功 / 1 解析异常 / 2 参数缺失 / 3 不支持的文件
 */
import net.sf.mpxj.Duration;
import net.sf.mpxj.ProjectFile;
import net.sf.mpxj.Relation;
import net.sf.mpxj.Resource;
import net.sf.mpxj.ResourceAssignment;
import net.sf.mpxj.Task;
import net.sf.mpxj.TimeUnit;
import net.sf.mpxj.reader.UniversalProjectReader;

import java.io.File;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public class MppImport {

    public static void main(String[] args) {
        if (args.length < 1) {
            System.err.println("usage: MppImport <file>");
            System.exit(2);
            return;
        }
        try {
            ProjectFile project = new UniversalProjectReader().read(new File(args[0]));
            if (project == null) {
                System.err.println("unsupported or unreadable file: " + args[0]);
                System.exit(3);
                return;
            }
            System.out.print(toJson(project));
            System.out.flush();
            System.exit(0);
        } catch (Throwable t) {
            String msg = t.getMessage();
            System.err.println(t.getClass().getSimpleName() + (msg == null ? "" : ": " + msg));
            System.exit(1);
        }
    }

    /* ------------------------------ JSON 组装 ------------------------------ */

    private static String toJson(ProjectFile project) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"name\":").append(str(projectTitle(project))).append(",\"tasks\":[");

        boolean first = true;
        List<Task> tasks = project.getTasks();
        if (tasks != null) {
            for (Task t : tasks) {
                if (t == null) continue;
                if (!first) sb.append(',');
                first = false;
                sb.append(taskJson(t));
            }
        }
        sb.append("]}");
        return sb.toString();
    }

    private static String taskJson(Task t) {
        StringBuilder sb = new StringBuilder();
        sb.append('{');
        sb.append("\"uid\":").append(str(uidOf(t)));
        sb.append(",\"name\":").append(str(t.getName()));
        sb.append(",\"start\":").append(str(date(t.getStart())));
        sb.append(",\"finish\":").append(str(date(t.getFinish())));
        sb.append(",\"parentUid\":").append(str(parentUidOf(t)));
        sb.append(",\"owner\":").append(str(ownerOf(t)));
        sb.append(",\"note\":").append(str(t.getNotes()));
        sb.append(",\"progress\":").append(num(progressOf(t)));
        sb.append(",\"predecessors\":" ).append(predecessorsJson(t));
        sb.append('}');
        return sb.toString();
    }

    private static String predecessorsJson(Task t) {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        try {
            List<Relation> rels = t.getPredecessors();
            if (rels != null) {
                for (Relation r : rels) {
                    if (r == null || r.getTargetTask() == null) continue;
                    if (!first) sb.append(',');
                    first = false;
                    sb.append("{\"uid\":").append(str(String.valueOf(r.getTargetTask().getUniqueID())));
                    sb.append(",\"type\":").append(str(typeOf(r)));
                    sb.append(",\"lagText\":").append(str(lagTextOf(r.getLag())));
                    sb.append('}');
                }
            }
        } catch (Throwable ignore) {
            // 无前置任务时 MPXJ 可能抛异常，按空数组处理
        }
        sb.append(']');
        return sb.toString();
    }

    /* ------------------------------ 字段取值 ------------------------------ */

    /** 项目名：MSPDI 常用 <Name>，MPP 用 title；两者都试，取第一个非空 */
    private static String projectTitle(ProjectFile project) {
        try {
            String title = project.getProjectProperties().getProjectTitle();
            if (title != null && !title.trim().isEmpty()) return title.trim();
            String name = project.getProjectProperties().getName();
            if (name != null && !name.trim().isEmpty()) return name.trim();
        } catch (Throwable ignore) {
        }
        return null;
    }

    private static String uidOf(Task t) {
        try {
            Object v = t.getUniqueID();
            return v == null ? null : String.valueOf(v);
        } catch (Throwable e) {
            return null;
        }
    }

    private static String parentUidOf(Task t) {
        try {
            Task p = t.getParentTask();
            if (p == null) return null;
            Object v = p.getUniqueID();
            return v == null ? null : String.valueOf(v);
        } catch (Throwable e) {
            return null;
        }
    }

    /** 负责人：取第一条资源分配的资源名；无则 null */
    private static String ownerOf(Task t) {
        try {
            List<ResourceAssignment> ras = t.getResourceAssignments();
            if (ras != null && !ras.isEmpty()) {
                ResourceAssignment ra = ras.get(0);
                if (ra != null && ra.getResource() != null) {
                    String n = ra.getResource().getName();
                    if (n != null && !n.trim().isEmpty()) return n.trim();
                }
            }
        } catch (Throwable ignore) {
        }
        return null;
    }

    /** 完成百分比（0-100）；MPXJ 各版本返回类型不一，统一按 Number 处理 */
    private static Double progressOf(Task t) {
        try {
            Object v = t.getPercentageComplete();
            if (v instanceof Number) {
                double d = ((Number) v).doubleValue();
                if (Double.isFinite(d)) return d;
            }
        } catch (Throwable ignore) {
        }
        return null;
    }

    private static String typeOf(Relation r) {
        try {
            String s = String.valueOf(r.getType());
            if (s == null) return "FS";
            s = s.toUpperCase();
            if (s.contains("START_START")) return "SS";
            if (s.contains("FINISH_FINISH")) return "FF";
            if (s.contains("START_FINISH")) return "SF";
            if (s.contains("FINISH_START")) return "FS";
        } catch (Throwable ignore) {
        }
        return "FS";
    }

    /**
     * 延迟量 → lagText。server 侧 parseLag 正则为 ^([+-]?)(\d+)([dwm])$，
     * 故必须取整且单位映射到 d/w/m。
     */
    private static String lagTextOf(Duration lag) {
        if (lag == null) return null;
        try {
            double raw = lag.getDuration();
            if (raw == 0) return null;
            TimeUnit u = lag.getUnits();
            String unit = "d";
            if (u == TimeUnit.WEEKS || u == TimeUnit.ELAPSED_WEEKS) unit = "w";
            else if (u == TimeUnit.MONTHS || u == TimeUnit.ELAPSED_MONTHS) unit = "m";
            long v = Math.round(raw);
            // 取整后为 0（如 20 分钟 → 0 天）视为无延迟，避免输出 "0d" 这类噪声
            if (v == 0) return null;
            return (v < 0 ? "-" : "") + Math.abs(v) + unit;
        } catch (Throwable ignore) {
            return null;
        }
    }

    /* ------------------------------ 基础序列化 ------------------------------ */

    /** MPXJ 13.x 的起止时间为 LocalDateTime（无时区，按日历日取 yyyy-MM-dd） */
    private static String date(LocalDateTime d) {
        if (d == null) return null;
        try {
            return d.toLocalDate().toString();
        } catch (Throwable e) {
            return null;
        }
    }

    private static String num(Double v) {
        return v == null ? "null" : String.valueOf(v);
    }

    private static String str(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                case '\b': sb.append("\\b");  break;
                case '\f': sb.append("\\f");  break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
