package app.supervpn.android.data

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Pure-text region and formatting helpers (no emoji icons). */
object NodePresentation {
    private val regionPatterns: List<Pair<Regex, String>> = listOf(
        Regex("香港|hong\\s*kong|\\bhk\\b", RegexOption.IGNORE_CASE) to "HK",
        Regex("台湾|台灣|taiwan|\\btw\\b|台北|taipei", RegexOption.IGNORE_CASE) to "TW",
        Regex("日本|japan|\\bjp\\b|东京|tokyo|大阪|osaka", RegexOption.IGNORE_CASE) to "JP",
        Regex("新加坡|狮城|singapore|\\bsg\\b", RegexOption.IGNORE_CASE) to "SG",
        Regex("美国|美國|united\\s*states|\\busa?\\b|洛杉矶|硅谷|西雅图|纽约|san\\s*jose|los\\s*angeles", RegexOption.IGNORE_CASE) to "US",
        Regex("韩国|韓國|korea|\\bkr\\b|首尔|seoul", RegexOption.IGNORE_CASE) to "KR",
        Regex("英国|英國|united\\s*kingdom|\\buk\\b|\\bgb\\b|伦敦|london", RegexOption.IGNORE_CASE) to "UK",
        Regex("德国|德國|germany|\\bde\\b|法兰克福|frankfurt", RegexOption.IGNORE_CASE) to "DE",
        Regex("法国|法國|france|\\bfr\\b|巴黎|paris", RegexOption.IGNORE_CASE) to "FR",
        Regex("荷兰|荷蘭|netherlands|\\bnl\\b|阿姆斯特丹", RegexOption.IGNORE_CASE) to "NL",
        Regex("加拿大|canada|\\bca\\b|多伦多|温哥华", RegexOption.IGNORE_CASE) to "CA",
        Regex("澳大利亚|澳洲|australia|\\bau\\b|悉尼", RegexOption.IGNORE_CASE) to "AU",
        Regex("俄罗斯|russia|\\bru\\b|莫斯科", RegexOption.IGNORE_CASE) to "RU",
        Regex("印度|india|\\bin\\b|孟买", RegexOption.IGNORE_CASE) to "IN",
        Regex("土耳其|turkey|\\btr\\b", RegexOption.IGNORE_CASE) to "TR",
        Regex("马来西亚|malaysia|\\bmy\\b", RegexOption.IGNORE_CASE) to "MY",
        Regex("泰国|thailand|\\bth\\b", RegexOption.IGNORE_CASE) to "TH",
        Regex("越南|vietnam|\\bvn\\b", RegexOption.IGNORE_CASE) to "VN",
        Regex("菲律宾|philippines|\\bph\\b", RegexOption.IGNORE_CASE) to "PH",
    )

    fun regionCode(name: String): String {
        for ((pattern, code) in regionPatterns) {
            if (pattern.containsMatchIn(name)) return code
        }
        return "GL"
    }

    fun formatBytes(bytes: Long): String {
        val value = bytes.coerceAtLeast(0L)
        if (value < 1024L) return "$value B"
        val units = arrayOf("KB", "MB", "GB", "TB", "PB")
        var n = value / 1024.0
        var idx = 0
        while (n >= 1024.0 && idx < units.lastIndex) {
            n /= 1024.0
            idx++
        }
        return if (idx >= 2) String.format(Locale.US, "%.2f %s", n, units[idx])
        else String.format(Locale.US, "%.1f %s", n, units[idx])
    }

    fun formatSpeed(bytesPerSecond: Long): String = "${formatBytes(bytesPerSecond)}/s"

    fun formatMbps(bytesPerSecond: Long): String {
        val mbps = bytesPerSecond.coerceAtLeast(0L) * 8.0 / 1_000_000.0
        return when {
            mbps >= 100.0 -> String.format(Locale.US, "%.0f Mbps", mbps)
            mbps >= 10.0 -> String.format(Locale.US, "%.1f Mbps", mbps)
            else -> String.format(Locale.US, "%.2f Mbps", mbps)
        }
    }

    fun formatRelativeTime(millis: Long, nowMillis: Long = System.currentTimeMillis()): String {
        if (millis <= 0L) return "尚未更新"
        val diffSec = ((nowMillis - millis) / 1000L).coerceAtLeast(0L)
        return when {
            diffSec < 60L -> "刚刚"
            diffSec < 3600L -> "${diffSec / 60L} 分钟前"
            diffSec < 86400L -> "${diffSec / 3600L} 小时前"
            diffSec < 86400L * 30L -> "${diffSec / 86400L} 天前"
            else -> formatTimestamp(millis)
        }
    }

    fun formatDuration(seconds: Long): String {
        val s = seconds.coerceAtLeast(0L)
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return String.format(Locale.US, "%02d:%02d:%02d", h, m, sec)
    }

    fun formatTimestamp(millis: Long): String {
        if (millis <= 0L) return "未知"
        return SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(millis))
    }

    fun formatExpire(epochSeconds: Long?): String {
        if (epochSeconds == null || epochSeconds <= 0L) return "长期有效"
        return SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date(epochSeconds * 1000L))
    }

    fun latencyTier(delayMs: Int?): String = when {
        delayMs == null || delayMs < 0 -> "failed"
        delayMs < 150 -> "good"
        delayMs < 400 -> "medium"
        else -> "slow"
    }
}
