package app.supervpn.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.supervpn.android.data.Runtime

@Composable
fun SettingsLogsScreen(
    initialTab: String = "settings",
    onBack: (() -> Unit)? = null,
) {
    var activeSubTab by remember(initialTab) { mutableStateOf(initialTab) } // "settings" | "logs"

    Column(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 6.dp)) {
            PageTopBar(
                title = if (activeSubTab == "settings") "内核与网络设置" else "运行日志",
                badge = if (activeSubTab == "logs") "${Runtime.logs.size} 条" else "v0.2.5",
                onBack = onBack,
            )
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                FilterChip(
                    selected = activeSubTab == "settings",
                    onClick = { activeSubTab = "settings" },
                    label = { Text("通用设置", fontSize = 12.sp) },
                    leadingIcon = { Icon(AppIcons.Settings, contentDescription = null, modifier = Modifier.size(15.dp)) },
                    shape = RoundedCornerShape(CardRadius),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.primary,
                    ),
                    modifier = Modifier.weight(1f),
                )
                FilterChip(
                    selected = activeSubTab == "logs",
                    onClick = { activeSubTab = "logs" },
                    label = { Text("运行日志", fontSize = 12.sp) },
                    leadingIcon = { Icon(AppIcons.Terminal, contentDescription = null, modifier = Modifier.size(15.dp)) },
                    shape = RoundedCornerShape(CardRadius),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                        selectedLabelColor = MaterialTheme.colorScheme.primary,
                    ),
                    modifier = Modifier.weight(1f),
                )
            }
        }

        if (activeSubTab == "settings") {
            SettingsTab()
        } else {
            LogsTab()
        }
    }
}

@Composable
private fun SettingsTab() {
    val settings = Runtime.data.settings

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(SectionGap),
    ) {
        item {
            OutlinedCardBox {
                Text("网络与路由", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(8.dp))
                Text("默认路由动作（规则模式下未命中规则的流量）", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("proxy" to "默认走代理", "direct" to "默认直连").forEach { (id, label) ->
                        FilterChip(
                            selected = settings.defaultAction == id,
                            onClick = { Runtime.setDefaultAction(id) },
                            label = { Text(label, fontSize = 12.sp) },
                            shape = RoundedCornerShape(CardRadius),
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                                selectedLabelColor = MaterialTheme.colorScheme.primary,
                            ),
                        )
                    }
                }
                Spacer(Modifier.height(6.dp))
                SettingToggleRow(
                    title = "局域网直连",
                    subtitle = "私有网段地址（如路由器、局域网设备）不经过代理",
                    checked = settings.bypassLan,
                    onCheckedChange = { Runtime.setBypassLan(it) },
                )
                SettingToggleRow(
                    title = "启用 IPv6 隧道",
                    subtitle = "为 TUN 接口分配 IPv6 地址并启用双栈解析（默认仅 IPv4 更稳定）",
                    checked = settings.ipv6Enabled,
                    onCheckedChange = { Runtime.setIpv6Enabled(it) },
                )
            }
        }

        item {
            OutlinedCardBox {
                Text("安全与存储", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(8.dp))
                SettingToggleRow(
                    title = "遵循节点自带的不安全证书标记",
                    subtitle = "仅当节点链接显式声明 insecure=1 / allowInsecure=1 时生效（与电脑端默认一致）；未标记节点始终严格验证证书",
                    checked = settings.allowInsecureNodes,
                    onCheckedChange = { Runtime.setAllowInsecureNodes(it) },
                )
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(AppIcons.Shield, contentDescription = null, tint = Success, modifier = Modifier.size(16.dp))
                    Text(
                        "节点密码与订阅地址已使用 Android Keystore（AES-256-GCM）加密存储于应用私有目录。",
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 16.sp,
                    )
                }
            }
        }

        item {
            OutlinedCardBox {
                Text("关于 SuperVPN Android", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(8.dp))
                InfoRow("应用版本", "0.2.5")
                InfoRow("代理内核", "sing-box v1.12.14 (libbox)")
                InfoRow("接管方式", "Android VpnService (TUN)")
                InfoRow("数据隔离", "与 Windows 电脑端各自独立")
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun LogsTab() {
    val clipboard = LocalClipboardManager.current
    var onlyErrors by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }
    val entries = remember(Runtime.logs.toList(), onlyErrors) {
        val list = Runtime.logs.asReversed()
        if (onlyErrors) list.filter { it.level == "error" || it.level == "warn" } else list
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                FilterChip(
                    selected = onlyErrors,
                    onClick = { onlyErrors = !onlyErrors },
                    label = { Text("仅警告/错误", fontSize = 11.sp) },
                    shape = RoundedCornerShape(CardRadius),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedButton(
                        onClick = {
                            val text = Runtime.logs.joinToString("\n") { "[${it.formattedTime()}] [${it.level.uppercase()}] ${it.message}" }
                            clipboard.setText(AnnotatedString(text))
                            copied = true
                        },
                        enabled = Runtime.logs.isNotEmpty(),
                        shape = RoundedCornerShape(CardRadius),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                    ) {
                        Icon(AppIcons.Copy, contentDescription = null, modifier = Modifier.size(13.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(if (copied) "已复制" else "复制", fontSize = 11.sp)
                    }
                    TextButton(onClick = { Runtime.clearLogs(); copied = false }, enabled = Runtime.logs.isNotEmpty()) {
                        Text("清空", fontSize = 12.sp, color = Danger)
                    }
                }
            }
        }

        if (entries.isEmpty()) {
            item {
                EmptyStateCard(
                    icon = AppIcons.Terminal,
                    title = "暂无运行日志",
                    subtitle = "连接代理或更新订阅后将在此记录真实运行状态",
                )
            }
        } else {
            items(entries) { entry ->
                val (badgeBg, badgeFg) = when (entry.level) {
                    "error" -> DangerSoft to Danger
                    "warn" -> WarningSoft to Warning
                    else -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
                }
                OutlinedCardBox(contentPadding = 10) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BadgePill(entry.level.uppercase(), background = badgeBg, contentColor = badgeFg)
                        Text(entry.formattedTime(), fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(5.dp))
                    Text(
                        entry.message,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace,
                        color = if (entry.level == "error") Danger else MaterialTheme.colorScheme.onSurface,
                        lineHeight = 16.sp,
                    )
                }
            }
        }
    }
}
