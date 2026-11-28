package app.supervpn.android

import app.supervpn.android.data.AppData
import app.supervpn.android.data.ConfigBuilder
import app.supervpn.android.data.LinkParser
import app.supervpn.android.data.Node
import app.supervpn.android.data.Settings
import app.supervpn.android.data.SubscriptionFetcher
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkParsingTest {
    @Test
    fun parsesVlessRealityWebSocket() {
        val node = LinkParser.parse(
            "vless://11111111-2222-3333-4444-555555555555@example.com:443?security=reality&pbk=abc&sid=12&type=ws&path=%2Fws&host=edge.example.com&sni=edge.example.com#Tokyo"
        )
        assertEquals("Tokyo", node.name)
        assertEquals("VLESS", node.protocol)
        assertEquals("example.com", node.host)
        assertEquals(443, node.port)
        val outbound = node.outbound
        assertEquals("vless", outbound.getString("type"))
        assertEquals("ws", outbound.getJSONObject("transport").getString("type"))
        assertEquals("/ws", outbound.getJSONObject("transport").getString("path"))
        assertTrue(outbound.getJSONObject("tls").getJSONObject("reality").getBoolean("enabled"))
    }

    @Test
    fun parsesShadowsocksBase64Credentials() {
        val payload = java.util.Base64.getEncoder().encodeToString("aes-128-gcm:secret".toByteArray())
        val node = LinkParser.parse("ss://$payload@1.2.3.4:8388#Node")
        assertEquals("shadowsocks", node.outbound.getString("type"))
        assertEquals("aes-128-gcm", node.outbound.getString("method"))
        assertEquals("secret", node.outbound.getString("password"))
        assertEquals(8388, node.port)
    }

    @Test
    fun parsesTrojanAndHysteria2() {
        val trojan = LinkParser.parse("trojan://pw@example.com:443?security=tls&sni=example.com#T")
        assertEquals("trojan", trojan.outbound.getString("type"))
        val hy2 = LinkParser.parse("hysteria2://pw@example.com:8443?obfs=salamander&obfs-password=x#H")
        assertEquals("hysteria2", hy2.outbound.getString("type"))
        assertEquals("salamander", hy2.outbound.getJSONObject("obfs").getString("type"))
    }

    @Test
    fun rejectsUnsupportedProtocolsWithoutLeakingCredentials() {
        val error = runCatching { LinkParser.parse("vmess://eyJhZGQiOiJ4In0=") }.exceptionOrNull()
        assertTrue(error != null)
        assertTrue(!error!!.message!!.contains("eyJhZGQiOiJ4In0"))
    }

    @Test
    fun parsesBase64Subscription() {
        val links = listOf(
            "vless://11111111-2222-3333-4444-555555555555@a.example.com:443?security=tls&sni=a.example.com#A",
            "trojan://pw@b.example.com:443#B",
            "vmess://eyJhZGQiOiJ4In0=",
        ).joinToString("\n")
        val encoded = java.util.Base64.getEncoder().encodeToString(links.toByteArray())
        val result = SubscriptionFetcher.parse(encoded)
        assertEquals(2, result.nodes.size)
        assertEquals(1, result.skipped)
        assertEquals(3, result.total)
    }

    @Test
    fun parsesClashYamlSubscriptionSafely() {
        val yaml = """
            proxies:
              - name: "HK VLESS"
                type: vless
                server: hk.example.com
                port: 443
                uuid: 11111111-2222-3333-4444-555555555555
                tls: true
                servername: hk.example.com
                reality-opts:
                  public-key: pubkey123
                  short-id: abcd
              - {name: "JP Trojan", type: trojan, server: jp.example.com, port: 443, password: secret-pw, network: ws, ws-opts: {path: /ws, headers: {Host: edge.jp.example.com}}}
              - name: "SG SS"
                type: ss
                server: sg.example.com
                port: 8388
                cipher: aes-256-gcm
                password: ss-secret-password
              - name: "Unsupported VMess"
                type: vmess
                server: vm.example.com
                port: 443
                uuid: 22222222-2222-2222-2222-222222222222
        """.trimIndent()
        val result = SubscriptionFetcher.parse(yaml)
        assertEquals(3, result.nodes.size)
        assertEquals(1, result.skipped)
        assertEquals(4, result.total)
        assertEquals("HK VLESS", result.nodes[0].name)
        assertTrue(result.nodes[0].outbound.getJSONObject("tls").getJSONObject("reality").getBoolean("enabled"))
        assertEquals("JP Trojan", result.nodes[1].name)
        assertEquals("/ws", result.nodes[1].outbound.getJSONObject("transport").getString("path"))
        assertEquals("shadowsocks", result.nodes[2].outbound.getString("type"))
    }
}

class ConfigBuilderTest {
    private val node = Node(
        id = "n1",
        name = "Node",
        protocol = "VLESS",
        host = "example.com",
        port = 443,
        outbound = JSONObject("""{"type":"vless","server":"example.com","server_port":443,"uuid":"11111111-2222-3333-4444-555555555555","tls":{"enabled":true,"server_name":"example.com"}}"""),
    )

    @Test
    fun buildsTunConfigWithModeAndTags() {
        val data = AppData(
            nodes = listOf(node),
            settings = Settings(selectedNodeId = "n1", outboundMode = "global", defaultAction = "proxy"),
        )
        val config = JSONObject(ConfigBuilder.build(data, node))
        assertEquals("Global", config.getJSONObject("experimental").getJSONObject("clash_api").getString("default_mode"))
        assertEquals("tun", config.getJSONArray("inbounds").getJSONObject(0).getString("type"))
        assertEquals("proxy", config.getJSONArray("outbounds").getJSONObject(0).getString("tag"))
        assertEquals("proxy", config.getJSONObject("route").getString("final"))
    }

    @Test
    fun insecureRequiresExplicitSetting() {
        val insecureNode = node.copy(insecureRequested = true)
        val strict = JSONObject(
            ConfigBuilder.build(
                AppData(nodes = listOf(insecureNode), settings = Settings(selectedNodeId = "n1", allowInsecureNodes = false)),
                insecureNode,
            )
        )
        assertTrue(!strict.getJSONArray("outbounds").getJSONObject(0).getJSONObject("tls").has("insecure"))

        val allowed = JSONObject(
            ConfigBuilder.build(
                AppData(nodes = listOf(insecureNode), settings = Settings(selectedNodeId = "n1", allowInsecureNodes = true)),
                insecureNode,
            )
        )
        assertTrue(allowed.getJSONArray("outbounds").getJSONObject(0).getJSONObject("tls").getBoolean("insecure"))

        // Unmarked nodes stay strictly verified even when honorImportedInsecure is true
        val unmarked = JSONObject(
            ConfigBuilder.build(
                AppData(nodes = listOf(node), settings = Settings(selectedNodeId = "n1", allowInsecureNodes = true)),
                node,
            )
        )
        assertTrue(!unmarked.getJSONArray("outbounds").getJSONObject(0).getJSONObject("tls").has("insecure"))
    }

    @Test
    fun directDefaultActionRoutesToDirect() {
        val config = JSONObject(
            ConfigBuilder.build(AppData(nodes = listOf(node), settings = Settings(selectedNodeId = "n1", defaultAction = "direct")), node)
        )
        assertEquals("direct", config.getJSONObject("route").getString("final"))
    }
}
