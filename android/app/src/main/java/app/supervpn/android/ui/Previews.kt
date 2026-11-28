package app.supervpn.android.ui

import android.content.res.Configuration
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import app.supervpn.android.SuperVpnApp
import app.supervpn.android.data.Runtime

@Preview(name = "完整 App 可交互预览（点右上角 ⋮ → Interactive）", showBackground = true, widthDp = 390, heightDp = 844, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun FullAppPreview() {
    SuperVpnTheme(themeMode = Runtime.data.settings.themeMode) {
        Surface(modifier = Modifier.fillMaxSize()) {
            SuperVpnApp(
                initialCrashReport = null,
                onConnect = {},
                onDisconnect = {},
                onReconnect = {},
            )
        }
    }
}

@Preview(name = "仪表盘 - 深色", showBackground = true, widthDp = 390, heightDp = 844, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "仪表盘 - 浅色", showBackground = true, widthDp = 390, heightDp = 844)
@Composable
private fun DashboardPreview() {
    SuperVpnTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            DashboardScreen(
                onConnect = {},
                onDisconnect = {},
                onReconnect = {},
                onOpenNodes = {},
                onOpenImport = {},
            )
        }
    }
}

@Preview(name = "代理网格 - 深色", showBackground = true, widthDp = 390, heightDp = 844, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun NodesPreview() {
    SuperVpnTheme(themeMode = "dark") {
        Surface(modifier = Modifier.fillMaxSize()) {
            NodesScreen(onOpenImport = {}, onSwitchConnectedNode = {})
        }
    }
}

@Preview(name = "配置管理 - 深色", showBackground = true, widthDp = 390, heightDp = 844, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun SubscriptionsPreview() {
    SuperVpnTheme(themeMode = "dark") {
        Surface(modifier = Modifier.fillMaxSize()) {
            SubscriptionsScreen(onOpenImport = {})
        }
    }
}

@Preview(name = "工具菜单 - 深色", showBackground = true, widthDp = 390, heightDp = 844, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun ToolsPreview() {
    SuperVpnTheme(themeMode = "dark") {
        Surface(modifier = Modifier.fillMaxSize()) {
            ToolsScreen(destination = ToolDestination.Menu, onNavigate = {}, onSwitchConnectedNode = {})
        }
    }
}

@Preview(name = "网络测速 - 深色", showBackground = true, widthDp = 390, heightDp = 844, uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun SpeedTestPreview() {
    SuperVpnTheme(themeMode = "dark") {
        Surface(modifier = Modifier.fillMaxSize()) {
            SpeedTestScreen(onBack = {})
        }
    }
}
