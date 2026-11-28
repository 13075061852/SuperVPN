package app.supervpn.android.data

import org.json.JSONArray
import org.json.JSONObject

/** Builds the sing-box configuration consumed by libbox (gVisor TUN + local mixed inbound). */
object ConfigBuilder {
    const val LOCAL_MIXED_PORT = 17890
    const val CLASH_API_PORT = 19090

    fun build(data: AppData, node: Node): String {
        val settings = data.settings
        val outbound = JSONObject(node.outbound.toString())
        outbound.put("tag", "proxy")
        if (node.insecureRequested && settings.allowInsecureNodes && outbound.has("tls")) {
            outbound.getJSONObject("tls").put("insecure", true)
        } else if (outbound.has("tls")) {
            outbound.getJSONObject("tls").remove("insecure")
        }

        val rules = JSONArray()
        rules.put(JSONObject().put("action", "sniff"))
        rules.put(JSONObject().put("protocol", "dns").put("action", "hijack-dns"))
        if (settings.bypassLan) {
            rules.put(JSONObject().put("ip_is_private", true).put("action", "route").put("outbound", "direct"))
        }
        rules.put(JSONObject().put("clash_mode", "Direct").put("action", "route").put("outbound", "direct"))
        rules.put(JSONObject().put("clash_mode", "Global").put("action", "route").put("outbound", "proxy"))

        // Website routing rules apply in Rule mode; longer/more-specific domains come first
        val enabledWebsiteRules = data.websiteRules
            .filter { it.enabled && it.domain.isNotBlank() }
            .sortedWith(compareByDescending<WebsiteRule> { it.domain.length }.thenBy { it.domain.lowercase() })

        val directDomains = mutableListOf<String>()
        for (rule in enabledWebsiteRules) {
            val domain = rule.domain.trim().lowercase().removeSuffix(".")
            val entry = JSONObject().put("domain_suffix", JSONArray().put(domain))
            when (rule.action) {
                "reject" -> entry.put("action", "reject")
                "direct" -> {
                    entry.put("action", "route").put("outbound", "direct")
                    directDomains += domain
                }
                else -> entry.put("action", "route").put("outbound", "proxy")
            }
            rules.put(entry)
        }

        val clashMode = when (settings.outboundMode) {
            "global" -> "Global"
            "direct" -> "Direct"
            else -> "Rule"
        }

        val dnsRules = JSONArray()
            .put(JSONObject().put("clash_mode", "Direct").put("server", "bootstrap"))
        if (directDomains.isNotEmpty()) {
            dnsRules.put(
                JSONObject()
                    .put("clash_mode", "Rule")
                    .put("domain_suffix", JSONArray().apply { directDomains.forEach { put(it) } })
                    .put("server", "bootstrap")
            )
        }

        val tunAddress = JSONArray().put("172.19.0.1/30")
        if (settings.ipv6Enabled) {
            tunAddress.put("fdfe:dcba:9876::1/126")
        }

        val root = JSONObject()
        root.put("log", JSONObject().put("level", "info").put("timestamp", true))
        root.put(
            "dns",
            JSONObject().put(
                "servers",
                JSONArray()
                    .put(JSONObject().put("type", "udp").put("tag", "bootstrap").put("server", "223.5.5.5"))
                    .put(
                        JSONObject().put("type", "https").put("tag", "remote").put("server", "1.1.1.1")
                            .put("path", "/dns-query").put("detour", "proxy")
                    )
            ).put("rules", dnsRules)
                .put("final", "remote")
                .put("strategy", if (settings.ipv6Enabled) "prefer_ipv4" else "ipv4_only")
        )
        root.put(
            "inbounds",
            JSONArray()
                .put(
                    JSONObject()
                        .put("type", "tun")
                        .put("tag", "tun-in")
                        .put("address", tunAddress)
                        .put("mtu", 1500)
                        .put("auto_route", true)
                        .put("strict_route", true)
                        .put("stack", "gvisor")
                )
                .put(
                    JSONObject()
                        .put("type", "mixed")
                        .put("tag", "mixed-in")
                        .put("listen", "127.0.0.1")
                        .put("listen_port", LOCAL_MIXED_PORT)
                )
        )
        root.put(
            "outbounds",
            JSONArray()
                .put(outbound)
                .put(JSONObject().put("type", "direct").put("tag", "direct"))
                .put(JSONObject().put("type", "block").put("tag", "block"))
        )
        root.put(
            "route",
            JSONObject()
                .put("rules", rules)
                .put("final", if (settings.defaultAction == "direct") "direct" else "proxy")
                .put("auto_detect_interface", true)
                .put("default_domain_resolver", "bootstrap")
        )
        root.put(
            "experimental",
            JSONObject().put(
                "clash_api",
                JSONObject().put("external_controller", "127.0.0.1:$CLASH_API_PORT").put("default_mode", clashMode)
            )
        )
        return root.toString()
    }
}
