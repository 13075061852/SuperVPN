package app.supervpn.android.data

import java.io.BufferedInputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.Base64
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

data class SubscriptionResult(
    val nodes: List<Node>,
    val total: Int,
    val skipped: Int,
    val failures: Map<String, Int>,
)

data class SubscriptionFetchPayload(
    val body: String,
    val usage: SubscriptionUsage?,
    val suggestedName: String? = null,
)

class SubscriptionException(message: String) : Exception(message)

object SubscriptionFetcher {
    private const val MAX_BYTES = 2 * 1024 * 1024

    fun fetch(url: String): String = fetchWithMetadata(url).body

    fun fetchWithMetadata(url: String): SubscriptionFetchPayload {
        val trimmed = url.trim()
        val parsed = try { URL(trimmed) } catch (_: Exception) { throw SubscriptionException("订阅地址无效") }
        if (parsed.protocol != "https") throw SubscriptionException("安卓版本仅支持 HTTPS 订阅地址")
        val connection = (parsed.openConnection() as HttpURLConnection).apply {
            connectTimeout = 20000
            readTimeout = 20000
            requestMethod = "GET"
            setRequestProperty("User-Agent", "SuperVPN-Android/0.2")
            instanceFollowRedirects = true
        }
        if (connection is HttpsURLConnection) {
            // Same policy as the desktop client: the certificate chain may be
            // self signed, but validity dates and the requested host name are
            // still enforced. Plain HTTP is never upgraded or downgraded.
            val context = SSLContext.getInstance("TLS")
            context.init(null, arrayOf<X509TrustManager>(LenientTrustManager), null)
            connection.sslSocketFactory = context.socketFactory
            connection.hostnameVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
        }
        try {
            val code = connection.responseCode
            if (code !in 200..299) throw SubscriptionException("订阅服务器返回 HTTP $code")
            val usage = parseSubscriptionUsage(connection.getHeaderField("Subscription-Userinfo"))
            val suggestedName = parseProfileTitle(connection.getHeaderField("Profile-Title"))
            val input = BufferedInputStream(connection.inputStream)
            val buffer = ByteArray(16384)
            val output = java.io.ByteArrayOutputStream()
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
                if (output.size() > MAX_BYTES) throw SubscriptionException("订阅内容超过 2 MB")
            }
            return SubscriptionFetchPayload(
                body = output.toString("UTF-8"),
                usage = usage,
                suggestedName = suggestedName,
            )
        } catch (e: SubscriptionException) {
            throw e
        } catch (e: Exception) {
            throw SubscriptionException("订阅下载失败：${e.message ?: e.javaClass.simpleName}")
        } finally {
            connection.disconnect()
        }
    }

    fun parseSubscriptionUsage(header: String?): SubscriptionUsage? {
        if (header.isNullOrBlank() || header.length > 4096) return null
        val values = mutableMapOf<String, Long>()
        val pattern = Regex("^(upload|download|total|expire)\\s*=\\s*(\\d+)$", RegexOption.IGNORE_CASE)
        for (piece in header.split(';')) {
            val match = pattern.matchEntire(piece.trim()) ?: continue
            val key = match.groupValues[1].lowercase()
            if (values.containsKey(key)) return null
            val num = match.groupValues[2].toLongOrNull() ?: return null
            if (num < 0L) return null
            values[key] = num
        }
        val upload = values["upload"] ?: return null
        val download = values["download"] ?: return null
        val total = values["total"] ?: return null
        if (Long.MAX_VALUE - upload < download) return null
        val expire = values["expire"]?.takeIf { it > 0L && it < 8_640_000_000_000L }
        return SubscriptionUsage(upload = upload, download = download, total = total, expire = expire)
    }

    private fun parseProfileTitle(header: String?): String? {
        if (header.isNullOrBlank()) return null
        val trimmed = header.trim()
        if (trimmed.startsWith("base64:", ignoreCase = true)) {
            return runCatching {
                val encoded = trimmed.substring(7).trim()
                Base64.getDecoder().decode(encoded).toString(Charsets.UTF_8).trim().take(80).ifEmpty { null }
            }.getOrNull()
        }
        return trimmed.take(80).ifEmpty { null }
    }

    fun parse(text: String): SubscriptionResult {
        if (text.length > MAX_BYTES) throw SubscriptionException("订阅内容过大")
        var body = text.removePrefix("\uFEFF").trim()
        if (!body.contains("://") && !ClashParser.isClashYaml(body) && Regex("^[A-Za-z0-9+/=_\\-\\s]+$").matches(body)) {
            body = try {
                val normalized = body.replace(Regex("\\s"), "").replace('-', '+').replace('_', '/')
                val padded = normalized + "=".repeat((4 - normalized.length % 4) % 4)
                Base64.getDecoder().decode(padded).toString(Charsets.UTF_8)
            } catch (_: Exception) {
                throw SubscriptionException("订阅 Base64 编码无效")
            }
        }
        if (ClashParser.isClashYaml(body)) {
            return ClashParser.parse(body)
        }
        if (Regex("^\\s*(\\{|\\[|<!doctype|<html)", RegexOption.IGNORE_CASE).containsMatchIn(body)) {
            throw SubscriptionException("暂不支持 JSON 或网页订阅")
        }
        val lines = body.lineSequence().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }.toList()
        if (lines.isEmpty() || lines.size > 2000) throw SubscriptionException("订阅为空或超过 2000 个节点")
        val nodes = mutableListOf<Node>()
        val failures = mutableMapOf<String, Int>()
        for (line in lines) {
            try {
                nodes += LinkParser.parse(line)
            } catch (e: Exception) {
                val protocol = line.substringBefore("://").uppercase().ifEmpty { "未知格式" }
                val key = "$protocol：${e.message ?: "参数不兼容"}"
                failures[key] = (failures[key] ?: 0) + 1
            }
        }
        if (nodes.isEmpty()) throw SubscriptionException("订阅中没有可用节点：" + failures.keys.joinToString("；"))
        return SubscriptionResult(nodes, lines.size, failures.values.sum(), failures)
    }

    fun looksLikeSubscriptionUrl(input: String): Boolean {
        val trimmed = input.trim()
        if (trimmed.contains('\n') || trimmed.contains('\r')) return false
        if (!trimmed.startsWith("https://", ignoreCase = true)) return false
        val uri = runCatching { URL(trimmed) }.getOrNull() ?: return false
        val hasPathOrQuery = (uri.path.isNotEmpty() && uri.path != "/") || !uri.query.isNullOrEmpty()
        val hasUserInfo = !uri.userInfo.isNullOrEmpty()
        return hasPathOrQuery || !hasUserInfo
    }

    private object LenientTrustManager : X509TrustManager {
        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            if (chain.isNullOrEmpty()) throw CertificateException("订阅服务器证书缺失")
            try {
                chain[0].checkValidity()
            } catch (_: Exception) {
                throw CertificateException("订阅服务器证书已过期或尚未生效")
            }
        }
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }

    fun digestFor(url: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(url.toByteArray())
        return bytes.take(8).joinToString("") { "%02x".format(it) }
    }
}
