package app.supervpn.android.data

import org.json.JSONObject
import java.net.URLDecoder
import java.util.UUID

class LinkParseException(message: String) : Exception(message)

/**
 * Port of the desktop link parser (shared/proxy.js) so both clients accept the
 * same node links and never silently drop transport parameters.
 */
object LinkParser {
    private val supported = setOf("http", "https", "socks", "socks5", "vless", "trojan", "ss", "anytls", "hysteria2", "hy2")

    fun parse(input: String): Node {
        val trimmed = input.trim()
        val (meta, outbound) = parseOutbound(trimmed)
        return Node(
            id = UUID.randomUUID().toString(),
            name = meta.name,
            protocol = meta.protocol,
            host = meta.host,
            port = meta.port,
            outbound = outbound,
            insecureRequested = meta.insecureRequested,
            rawLink = trimmed,
        )
    }

    private data class Meta(val name: String, val protocol: String, val host: String, val port: Int, val insecureRequested: Boolean)

    private fun parseOutbound(input: String): Pair<Meta, JSONObject> {
        var raw = input
        if (raw.length > 16384) throw LinkParseException("节点链接过长")
        val scheme = raw.substringBefore(':').lowercase()
        if (scheme !in supported) throw LinkParseException("暂不支持的协议：$scheme")

        if (scheme == "ss") {
            val rest = raw.substring(5).substringBefore('#')
            if (!rest.contains("@")) {
                val decoded = decodeBase64(rest)
                val hash = if (raw.contains('#')) "#" + raw.substringAfter('#') else ""
                raw = "ss://$decoded$hash"
            }
        }

        val uri = parseUri(raw) ?: throw LinkParseException("链接格式无效，请粘贴完整的代理链接")
        if (scheme == "http" || scheme == "https") {
            if (uri.path.isNotEmpty() && uri.path != "/" || uri.query.isNotEmpty()) throw LinkParseException("这是订阅地址，请通过订阅导入")
        }
        val host = uri.host.trim('[', ']')
        if (host.isEmpty()) throw LinkParseException("服务器地址无效")
        val defaultPort = when (scheme) { "http" -> 80; "https" -> 443; else -> 0 }
        val port = uri.port ?: defaultPort
        if (port !in 1..65535) throw LinkParseException("端口无效")

        val type = when (scheme) { "https" -> "http"; "socks5" -> "socks"; "hy2" -> "hysteria2"; else -> scheme }
        val out = JSONObject().apply {
            put("type", type)
            put("tag", "proxy")
            put("server", host)
            put("server_port", port)
        }
        val query = uri.queryParams

        if (type == "http" || type == "socks") {
            uri.user?.let { out.put("username", it) }
            uri.password?.let { out.put("password", it) }
            if (type == "socks") out.put("version", "5")
            if (scheme == "https") out.put("tls", JSONObject().put("enabled", true).put("server_name", host))
        }

        if (type == "ss") {
            out.put("type", "shadowsocks")
            val credentials = if (uri.password.isNullOrEmpty()) decodeBase64(uri.user ?: "") else "${uri.user}:${uri.password}"
            val index = credentials.indexOf(':')
            if (index < 1 || credentials.substring(index + 1).isEmpty()) throw LinkParseException("Shadowsocks 认证信息不完整")
            out.put("method", credentials.substring(0, index))
            out.put("password", credentials.substring(index + 1))
            if (query.containsKey("plugin")) throw LinkParseException("暂不支持带插件的 Shadowsocks")
        }

        if (type == "vless") {
            val uuid = uri.user ?: throw LinkParseException("VLESS UUID 无效")
            if (!Regex("^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$").matches(uuid)) throw LinkParseException("VLESS UUID 无效")
            out.put("uuid", uuid)
            query["flow"]?.let { out.put("flow", it) }
            val encryption = query["encryption"]
            if (encryption != null && encryption != "none") throw LinkParseException("暂不支持此 VLESS 加密方式")
        }

        if (type == "trojan") {
            if (uri.user.isNullOrEmpty()) throw LinkParseException("Trojan 密码不能为空")
            out.put("password", uri.user)
        }

        if (type == "vless" || type == "trojan") {
            val security = query["security"] ?: if (type == "trojan") "tls" else "none"
            if (security !in setOf("none", "tls", "reality")) throw LinkParseException("不支持的 TLS 安全模式")
            if (security != "none") {
                val tls = JSONObject().put("enabled", true)
                    .put("server_name", query["sni"] ?: query["peer"] ?: host)
                query["alpn"]?.split(',')?.takeIf { it.isNotEmpty() }?.let { list ->
                    tls.put("alpn", org.json.JSONArray().apply { list.forEach { put(it) } })
                }
                val fingerprint = query["fp"]
                if (fingerprint != null || security == "reality") {
                    tls.put("utls", JSONObject().put("enabled", true).put("fingerprint", fingerprint ?: "chrome"))
                }
                if (security == "reality") {
                    val publicKey = query["pbk"] ?: throw LinkParseException("Reality 链接缺少公钥 pbk")
                    tls.put("reality", JSONObject().put("enabled", true).put("public_key", publicKey).put("short_id", query["sid"] ?: ""))
                }
                out.put("tls", tls)
            }
            when (val transport = query["type"] ?: "tcp") {
                "ws" -> out.put("transport", JSONObject().put("type", "ws").put("path", query["path"] ?: "/").apply {
                    query["host"]?.let { put("headers", JSONObject().put("Host", it)) }
                })
                "grpc" -> out.put("transport", JSONObject().put("type", "grpc").put("service_name", query["serviceName"] ?: ""))
                "httpupgrade" -> out.put("transport", JSONObject().put("type", "httpupgrade").put("path", query["path"] ?: "/").put("host", query["host"] ?: host))
                "tcp" -> Unit
                else -> throw LinkParseException("暂不支持 $transport 传输方式")
            }
        }

        if (type == "anytls" || type == "hysteria2") {
            if (uri.user.isNullOrEmpty()) throw LinkParseException("节点缺少密码")
            out.put("password", uri.user + (uri.password?.let { ":$it" } ?: ""))
            val tls = JSONObject().put("enabled", true).put("server_name", query["sni"] ?: query["peer"] ?: host)
            query["alpn"]?.split(',')?.takeIf { it.isNotEmpty() }?.let { list ->
                tls.put("alpn", org.json.JSONArray().apply { list.forEach { put(it) } })
            }
            if (type == "anytls") query["fp"]?.let { tls.put("utls", JSONObject().put("enabled", true).put("fingerprint", it)) }
            out.put("tls", tls)
            if (type == "hysteria2") {
                val obfs = query["obfs"]
                if (obfs != null) {
                    if (obfs != "salamander" || query["obfs-password"].isNullOrEmpty()) throw LinkParseException("Hysteria2 混淆参数不完整")
                    out.put("obfs", JSONObject().put("type", "salamander").put("password", query["obfs-password"]))
                }
            }
        }

        val insecure = query["allowInsecure"] in setOf("1", "true") || query["insecure"] in setOf("1", "true")
        val name = uri.fragment?.takeIf { it.isNotEmpty() } ?: "$host:$port"
        val displayProtocol = when (scheme) { "socks" -> "SOCKS5"; "socks5" -> "SOCKS5"; "hy2" -> "HYSTERIA2"; else -> scheme.uppercase() }
        return Meta(name, displayProtocol, host, port, insecure) to out
    }

    private fun decodeBase64(value: String): String {
        return try {
            val normalized = value.replace('-', '+').replace('_', '/').trim()
            val padded = normalized + "=".repeat((4 - normalized.length % 4) % 4)
            java.util.Base64.getDecoder().decode(padded).toString(Charsets.UTF_8)
        } catch (e: Exception) {
            throw LinkParseException("无效的 Base64 认证信息")
        }
    }

    private class ParsedUri(
        val host: String,
        val port: Int?,
        val path: String,
        val query: String,
        val fragment: String?,
        val user: String?,
        val password: String?,
    ) {
        val queryParams: Map<String, String> by lazy {
            if (query.isEmpty()) emptyMap()
            else query.split('&').mapNotNull { pair ->
                if (pair.isEmpty()) return@mapNotNull null
                val key = pair.substringBefore('=')
                val value = if (pair.contains('=')) pair.substringAfter('=') else ""
                decode(key) to decode(value)
            }.toMap()
        }
    }

    private fun parseUri(raw: String): ParsedUri? {
        val schemeEnd = raw.indexOf("://")
        if (schemeEnd < 0) return null
        val rest = raw.substring(schemeEnd + 3)
        val fragment = if (rest.contains('#')) rest.substringAfter('#') else null
        val withoutFragment = rest.substringBefore('#')
        val queryIndex = withoutFragment.indexOf('?')
        val query = if (queryIndex >= 0) withoutFragment.substring(queryIndex + 1) else ""
        val withoutQuery = withoutFragment.substringBefore('?')
        val slashIndex = withoutQuery.indexOf('/')
        val authority = if (slashIndex >= 0) withoutQuery.substring(0, slashIndex) else withoutQuery
        val path = if (slashIndex >= 0) withoutQuery.substring(slashIndex) else ""

        val at = authority.lastIndexOf('@')
        val userInfo = if (at >= 0) authority.substring(0, at) else null
        val hostPort = if (at >= 0) authority.substring(at + 1) else authority

        val host: String
        val portText: String?
        if (hostPort.startsWith("[")) {
            val close = hostPort.indexOf(']')
            if (close < 0) return null
            host = hostPort.substring(0, close + 1)
            portText = hostPort.substring(close + 1).removePrefix(":").takeIf { it.isNotEmpty() }
        } else {
            val colon = hostPort.lastIndexOf(':')
            if (colon >= 0) {
                host = hostPort.substring(0, colon)
                portText = hostPort.substring(colon + 1).takeIf { it.isNotEmpty() }
            } else {
                host = hostPort
                portText = null
            }
        }
        val port = portText?.toIntOrNull() ?: if (portText == null) null else throw LinkParseException("端口无效")
        val user: String?
        val password: String?
        if (userInfo == null) {
            user = null
            password = null
        } else if (userInfo.contains(':')) {
            val index = userInfo.indexOf(':')
            user = decode(userInfo.substring(0, index))
            password = decode(userInfo.substring(index + 1))
        } else {
            user = decode(userInfo)
            password = null
        }
        return ParsedUri(host, port, path, query, fragment?.let { decode(it) }, user, password)
    }

    private fun decode(value: String): String = try {
        URLDecoder.decode(value, "UTF-8")
    } catch (e: Exception) {
        throw LinkParseException("链接包含无效的编码")
    }
}
