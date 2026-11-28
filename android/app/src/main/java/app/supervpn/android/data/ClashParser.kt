package app.supervpn.android.data

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

/**
 * Zero-dependency, safe Clash YAML `proxies:` parser supporting both flow-style
 * (`- {name: ..., type: ...}`) and block-style multi-line proxy entries.
 * Supports VLESS, Trojan, Shadowsocks (ss), Hysteria2, and AnyTLS.
 */
object ClashParser {
    private val unsupportedExtensions = setOf(
        "plugin", "http-opts", "h2-opts", "ech-opts", "smux", "dialer-proxy", "packet-encoding"
    )

    fun isClashYaml(body: String): Boolean =
        Regex("^\\s*proxies\\s*:", RegexOption.MULTILINE).containsMatchIn(body)

    fun parse(body: String): SubscriptionResult {
        val rawEntries = extractProxyMaps(body)
        if (rawEntries.isEmpty() || rawEntries.size > 2000) {
            throw SubscriptionException("Clash 订阅为空或超过 2000 个节点")
        }
        val nodes = mutableListOf<Node>()
        val failures = mutableMapOf<String, Int>()
        for (entry in rawEntries) {
            val type = (entry["type"] as? String)?.lowercase()?.trim().orEmpty()
            val protocol = if (type.matches(Regex("^[a-z0-9-]{1,24}$"))) type.uppercase() else "CLASH"
            try {
                nodes += convertProxy(entry)
            } catch (e: Exception) {
                val key = "$protocol：${e.message ?: "参数不兼容"}"
                failures[key] = (failures[key] ?: 0) + 1
            }
        }
        if (nodes.isEmpty()) {
            throw SubscriptionException("Clash 订阅中没有可用节点：" + failures.keys.joinToString("；"))
        }
        return SubscriptionResult(nodes, rawEntries.size, failures.values.sum(), failures)
    }

    private fun convertProxy(proxy: Map<String, Any?>): Node {
        val type = scalar(proxy["type"]).lowercase()
        val supportedTypes = setOf("vless", "trojan", "ss", "hysteria2", "hy2", "anytls")
        if (type !in supportedTypes) {
            throw LinkParseException("暂不支持该 Clash 协议类型")
        }
        for (field in unsupportedExtensions) {
            if (proxy.containsKey(field) && proxy[field] != null) {
                throw LinkParseException("Clash 节点包含未兼容扩展")
            }
        }

        val rawHost = scalar(proxy["server"])
        val port = scalar(proxy["port"]).toIntOrNull() ?: 0
        if (rawHost.isEmpty() || Regex("[\\s/@?#]").containsMatchIn(rawHost) || port !in 1..65535) {
            throw LinkParseException("Clash 节点地址或端口无效")
        }
        val host = rawHost.trim('[', ']')
        val name = scalar(proxy["name"]).take(200).ifEmpty { "$host:$port" }
        val insecure = boolValue(proxy["skip-cert-verify"])

        if (type == "ss") {
            val cipher = scalar(proxy["cipher"])
            val password = scalar(proxy["password"])
            if (cipher.isEmpty() || password.isEmpty()) throw LinkParseException("Shadowsocks 认证信息不完整")
            val outbound = JSONObject().apply {
                put("type", "shadowsocks")
                put("tag", "proxy")
                put("server", host)
                put("server_port", port)
                put("method", cipher)
                put("password", password)
            }
            return Node(
                id = UUID.randomUUID().toString(),
                name = name,
                protocol = "SS",
                host = host,
                port = port,
                outbound = outbound,
                insecureRequested = false,
            )
        }

        if (type == "hysteria2" || type == "hy2" || type == "anytls") {
            val normalizedType = if (type == "hy2") "hysteria2" else type
            val password = scalar(proxy["password"])
            if (password.isEmpty()) throw LinkParseException("节点缺少密码")
            val sni = scalar(proxy["sni"]).ifEmpty { scalar(proxy["servername"]).ifEmpty { host } }
            val tls = JSONObject().put("enabled", true).put("server_name", sni)
            extractStringList(proxy["alpn"])?.takeIf { it.isNotEmpty() }?.let { list ->
                tls.put("alpn", JSONArray().apply { list.forEach { put(it) } })
            }
            val fp = scalar(proxy["client-fingerprint"])
            if (normalizedType == "anytls" && fp.isNotEmpty()) {
                tls.put("utls", JSONObject().put("enabled", true).put("fingerprint", fp))
            }
            val outbound = JSONObject().apply {
                put("type", normalizedType)
                put("tag", "proxy")
                put("server", host)
                put("server_port", port)
                put("password", password)
                put("tls", tls)
            }
            if (normalizedType == "hysteria2") {
                val obfs = scalar(proxy["obfs"])
                if (obfs.isNotEmpty()) {
                    val obfsPassword = scalar(proxy["obfs-password"])
                    if (obfs != "salamander" || obfsPassword.isEmpty()) {
                        throw LinkParseException("Hysteria2 混淆参数不完整")
                    }
                    outbound.put("obfs", JSONObject().put("type", "salamander").put("password", obfsPassword))
                }
            }
            return Node(
                id = UUID.randomUUID().toString(),
                name = name,
                protocol = normalizedType.uppercase(),
                host = host,
                port = port,
                outbound = outbound,
                insecureRequested = insecure,
            )
        }

        // VLESS & Trojan: build standard link and reuse LinkParser for identical validation
        val hostPart = if (host.contains(':')) "[$host]" else host
        val params = mutableListOf<String>()
        fun addParam(k: String, v: String) {
            if (v.isNotEmpty()) params += "${enc(k)}=${enc(v)}"
        }

        @Suppress("UNCHECKED_CAST")
        val reality = proxy["reality-opts"] as? Map<String, Any?>
        val tlsEnabled = type == "trojan" || boolValue(proxy["tls"]) || reality != null
        addParam("security", when {
            reality != null -> "reality"
            tlsEnabled -> "tls"
            else -> "none"
        })
        val sni = scalar(proxy["servername"]).ifEmpty { scalar(proxy["sni"]) }
        addParam("sni", sni)
        addParam("flow", scalar(proxy["flow"]))
        addParam("fp", scalar(proxy["client-fingerprint"]))
        if (insecure) addParam("allowInsecure", "1")
        extractStringList(proxy["alpn"])?.takeIf { it.isNotEmpty() }?.let {
            addParam("alpn", it.joinToString(","))
        }
        if (reality != null) {
            addParam("pbk", scalar(reality["public-key"]))
            addParam("sid", scalar(reality["short-id"]))
        }

        val network = scalar(proxy["network"]).ifEmpty { "tcp" }.lowercase()
        addParam("type", network)
        when (network) {
            "ws", "httpupgrade" -> {
                @Suppress("UNCHECKED_CAST")
                val opts = (proxy[if (network == "ws") "ws-opts" else "http-upgrade-opts"] as? Map<String, Any?>).orEmpty()
                if (opts["max-early-data"] != null || opts["early-data-header-name"] != null) {
                    throw LinkParseException("Clash 早期数据扩展未兼容")
                }
                addParam("path", scalar(opts["path"]).ifEmpty { "/" })
                @Suppress("UNCHECKED_CAST")
                val headers = (opts["headers"] as? Map<String, Any?>).orEmpty()
                if (headers.keys.any { !it.equals("host", ignoreCase = true) }) {
                    throw LinkParseException("Clash 自定义请求头未兼容")
                }
                val hostHeader = headers.entries.firstOrNull { it.key.equals("host", ignoreCase = true) }?.value
                addParam("host", scalar(hostHeader))
            }
            "grpc" -> {
                @Suppress("UNCHECKED_CAST")
                val opts = (proxy["grpc-opts"] as? Map<String, Any?>).orEmpty()
                addParam("serviceName", scalar(opts["grpc-service-name"]))
            }
            "tcp" -> Unit
            else -> throw LinkParseException("Clash 传输方式未兼容")
        }

        val credential = scalar(if (type == "vless") proxy["uuid"] else proxy["password"])
        val link = "$type://${enc(credential)}@$hostPart:$port?${params.joinToString("&")}#${enc(name)}"
        return LinkParser.parse(link)
    }

    private fun extractProxyMaps(body: String): List<Map<String, Any?>> {
        val lines = body.lines()
        val result = mutableListOf<Map<String, Any?>>()
        var inProxies = false
        var proxiesIndent = -1
        var i = 0

        while (i < lines.size) {
            val rawLine = lines[i]
            val trimmed = stripInlineComment(rawLine).trim()
            if (trimmed.isEmpty()) {
                i++
                continue
            }
            val indent = rawLine.indexOfFirst { it != ' ' && it != '\t' }.coerceAtLeast(0)

            if (!inProxies) {
                if (trimmed == "proxies:" || trimmed.startsWith("proxies:")) {
                    inProxies = true
                    proxiesIndent = indent
                }
                i++
                continue
            }

            // Exited proxies block when encountering another top-level key
            if (indent <= proxiesIndent && !trimmed.startsWith("-")) {
                break
            }

            if (trimmed.startsWith("-")) {
                val afterDash = trimmed.substring(1).trim()
                if (afterDash.startsWith("{")) {
                    val map = parseFlowMap(afterDash)
                    if (map != null) result += map
                    i++
                } else {
                    val itemIndent = indent
                    val map = linkedMapOf<String, Any?>()
                    if (afterDash.isNotEmpty() && afterDash.contains(':')) {
                        val (k, v) = splitKeyValue(afterDash)
                        if (k.isNotEmpty()) map[k] = parseScalarOrFlow(v)
                    }
                    i++
                    while (i < lines.size) {
                        val nextRaw = lines[i]
                        val nextTrim = stripInlineComment(nextRaw).trim()
                        if (nextTrim.isEmpty()) {
                            i++
                            continue
                        }
                        val nextIndent = nextRaw.indexOfFirst { it != ' ' && it != '\t' }.coerceAtLeast(0)
                        if (nextIndent <= itemIndent) break

                        if (nextTrim.contains(':')) {
                            val (k, v) = splitKeyValue(nextTrim)
                            if (v.isEmpty()) {
                                // Nested map or list
                                val nested = parseNestedBlock(lines, i + 1, nextIndent)
                                map[k] = nested.first
                                i = nested.second
                                continue
                            } else {
                                map[k] = parseScalarOrFlow(v)
                            }
                        }
                        i++
                    }
                    if (map.isNotEmpty()) result += map
                }
            } else {
                i++
            }
        }
        return result
    }

    private fun parseNestedBlock(lines: List<String>, startIndex: Int, parentIndent: Int): Pair<Any, Int> {
        var i = startIndex
        while (i < lines.size && stripInlineComment(lines[i]).trim().isEmpty()) i++
        if (i >= lines.size) return emptyMap<String, Any?>() to i
        val firstTrim = stripInlineComment(lines[i]).trim()
        val firstIndent = lines[i].indexOfFirst { it != ' ' && it != '\t' }.coerceAtLeast(0)
        if (firstIndent <= parentIndent) return emptyMap<String, Any?>() to i

        if (firstTrim.startsWith("-")) {
            val list = mutableListOf<Any?>()
            while (i < lines.size) {
                val raw = lines[i]
                val trim = stripInlineComment(raw).trim()
                if (trim.isEmpty()) {
                    i++
                    continue
                }
                val ind = raw.indexOfFirst { it != ' ' && it != '\t' }.coerceAtLeast(0)
                if (ind <= parentIndent || !trim.startsWith("-")) break
                list += parseScalarOrFlow(trim.substring(1).trim())
                i++
            }
            return list to i
        }

        val map = linkedMapOf<String, Any?>()
        while (i < lines.size) {
            val raw = lines[i]
            val trim = stripInlineComment(raw).trim()
            if (trim.isEmpty()) {
                i++
                continue
            }
            val ind = raw.indexOfFirst { it != ' ' && it != '\t' }.coerceAtLeast(0)
            if (ind <= parentIndent) break
            if (trim.contains(':')) {
                val (k, v) = splitKeyValue(trim)
                if (v.isEmpty()) {
                    val nested = parseNestedBlock(lines, i + 1, ind)
                    map[k] = nested.first
                    i = nested.second
                    continue
                } else {
                    map[k] = parseScalarOrFlow(v)
                }
            }
            i++
        }
        return map to i
    }

    private fun parseFlowMap(text: String): Map<String, Any?>? {
        val inner = text.trim()
        if (!inner.startsWith("{") || !inner.endsWith("}")) return null
        val content = inner.substring(1, inner.length - 1).trim()
        if (content.isEmpty()) return emptyMap()
        val parts = splitTopLevel(content, ',')
        val map = linkedMapOf<String, Any?>()
        for (part in parts) {
            val trimmed = part.trim()
            if (trimmed.isEmpty()) continue
            val colon = findTopLevelColon(trimmed)
            if (colon < 0) continue
            val key = unquote(trimmed.substring(0, colon).trim())
            val value = trimmed.substring(colon + 1).trim()
            map[key] = parseScalarOrFlow(value)
        }
        return map
    }

    private fun parseFlowList(text: String): List<Any?> {
        val content = text.trim().removePrefix("[").removeSuffix("]").trim()
        if (content.isEmpty()) return emptyList()
        return splitTopLevel(content, ',').map { parseScalarOrFlow(it.trim()) }
    }

    private fun parseScalarOrFlow(value: String): Any? {
        val v = value.trim()
        if (v.isEmpty() || v == "null" || v == "~") return null
        if (v.startsWith("{") && v.endsWith("}")) return parseFlowMap(v)
        if (v.startsWith("[") && v.endsWith("]")) return parseFlowList(v)
        if (v.equals("true", ignoreCase = true)) return true
        if (v.equals("false", ignoreCase = true)) return false
        return unquote(v)
    }

    private fun splitTopLevel(text: String, delimiter: Char): List<String> {
        val out = mutableListOf<String>()
        val sb = StringBuilder()
        var depthBrace = 0
        var depthBracket = 0
        var quote: Char? = null
        var escaped = false
        for (ch in text) {
            if (escaped) {
                sb.append(ch)
                escaped = false
                continue
            }
            if (quote != null) {
                sb.append(ch)
                if (ch == '\\' && quote == '"') escaped = true
                else if (ch == quote) quote = null
                continue
            }
            when (ch) {
                '"', '\'' -> { quote = ch; sb.append(ch) }
                '{' -> { depthBrace++; sb.append(ch) }
                '}' -> { depthBrace = (depthBrace - 1).coerceAtLeast(0); sb.append(ch) }
                '[' -> { depthBracket++; sb.append(ch) }
                ']' -> { depthBracket = (depthBracket - 1).coerceAtLeast(0); sb.append(ch) }
                delimiter -> {
                    if (depthBrace == 0 && depthBracket == 0) {
                        out += sb.toString()
                        sb.clear()
                    } else {
                        sb.append(ch)
                    }
                }
                else -> sb.append(ch)
            }
        }
        if (sb.isNotEmpty()) out += sb.toString()
        return out
    }

    private fun findTopLevelColon(text: String): Int {
        var quote: Char? = null
        var escaped = false
        for (i in text.indices) {
            val ch = text[i]
            if (escaped) {
                escaped = false
                continue
            }
            if (quote != null) {
                if (ch == '\\' && quote == '"') escaped = true
                else if (ch == quote) quote = null
                continue
            }
            if (ch == '"' || ch == '\'') {
                quote = ch
            } else if (ch == ':' && (i + 1 == text.length || text[i + 1].isWhitespace())) {
                return i
            }
        }
        return text.indexOf(':')
    }

    private fun splitKeyValue(line: String): Pair<String, String> {
        val idx = findTopLevelColon(line)
        if (idx < 0) return "" to ""
        return unquote(line.substring(0, idx).trim()) to line.substring(idx + 1).trim()
    }

    private fun stripInlineComment(line: String): String {
        var quote: Char? = null
        var escaped = false
        for (i in line.indices) {
            val ch = line[i]
            if (escaped) {
                escaped = false
                continue
            }
            if (quote != null) {
                if (ch == '\\' && quote == '"') escaped = true
                else if (ch == quote) quote = null
                continue
            }
            if (ch == '"' || ch == '\'') {
                quote = ch
            } else if (ch == '#' && (i == 0 || line[i - 1].isWhitespace())) {
                return line.substring(0, i)
            }
        }
        return line
    }

    private fun unquote(value: String): String {
        if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
            val inner = value.substring(1, value.length - 1)
            return if (value.startsWith("\"")) {
                inner.replace("\\\"", "\"").replace("\\\\", "\\")
            } else {
                inner.replace("''", "'")
            }
        }
        return value
    }

    private fun scalar(value: Any?): String = when (value) {
        null -> ""
        is String -> value.trim()
        is Number, is Boolean -> value.toString()
        else -> throw LinkParseException("Clash 节点参数无效")
    }

    private fun boolValue(value: Any?): Boolean = when (value) {
        is Boolean -> value
        is String -> value.equals("true", ignoreCase = true) || value == "1"
        else -> false
    }

    private fun extractStringList(value: Any?): List<String>? {
        if (value == null) return null
        if (value is List<*>) {
            return value.map { scalar(it) }.filter { it.isNotEmpty() }
        }
        if (value is String && value.isNotBlank()) {
            return value.split(',').map { it.trim() }.filter { it.isNotEmpty() }
        }
        throw LinkParseException("Clash ALPN 参数无效")
    }

    private fun enc(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
}
