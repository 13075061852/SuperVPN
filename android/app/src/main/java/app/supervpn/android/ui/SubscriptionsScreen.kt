package app.supervpn.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.supervpn.android.data.NodePresentation
import app.supervpn.android.data.Runtime
import app.supervpn.android.data.Subscription
import app.supervpn.android.data.SubscriptionFetcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SubscriptionsScreen(
    onOpenImport: () -> Unit,
    onSelectSubscription: (String) -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    val data = Runtime.data
    val activeSubId = Runtime.activeNode()?.subscriptionId
    var updatingId by remember { mutableStateOf<String?>(null) }
    var updatingAll by remember { mutableStateOf(false) }
    var sortMode by remember { mutableStateOf("default") } // "default" | "updated" | "count"
    var sortMenuExpanded by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var renameTarget by remember { mutableStateOf<Subscription?>(null) }

    val sortedSubs = remember(data.subscriptions, sortMode) {
        when (sortMode) {
            "updated" -> data.subscriptions.sortedByDescending { it.updatedAt }
            "count" -> data.subscriptions.sortedByDescending { it.count }
            else -> data.subscriptions
        }
    }

    suspend fun refreshSubscription(sub: Subscription): Result<Int> = withContext(Dispatchers.IO) {
        runCatching {
            val payload = SubscriptionFetcher.fetchWithMetadata(sub.url)
            val parsed = SubscriptionFetcher.parse(payload.body)
            val updated = sub.copy(
                count = parsed.nodes.size,
                updatedAt = System.currentTimeMillis(),
                usage = payload.usage ?: sub.usage,
            )
            withContext(Dispatchers.Main) {
                Runtime.applySubscription(updated, parsed.nodes.map { it.copy(subscriptionId = sub.id) })
                Runtime.appendLog("订阅「${sub.name}」已更新：${parsed.nodes.size} 个节点，跳过 ${parsed.skipped}")
            }
            parsed.nodes.size
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 92.dp),
            verticalArrangement = Arrangement.spacedBy(SectionGap),
        ) {
            item {
                PageTopBar(
                    title = "配置",
                    actions = {
                        if (data.subscriptions.isNotEmpty()) {
                            IconButton(
                                enabled = !updatingAll && updatingId == null,
                                onClick = {
                                    scope.launch {
                                        updatingAll = true
                                        feedback = null
                                        var okCount = 0
                                        var failCount = 0
                                        for (sub in data.subscriptions) {
                                            updatingId = sub.id
                                            val res = refreshSubscription(sub)
                                            if (res.isSuccess) okCount++ else failCount++
                                        }
                                        updatingId = null
                                        updatingAll = false
                                        feedback = "全部更新完成：成功 $okCount，失败 $failCount"
                                    }
                                },
                            ) {
                                Icon(
                                    AppIcons.Refresh,
                                    contentDescription = "全部更新",
                                    tint = MaterialTheme.colorScheme.onBackground,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                            Box {
                                IconButton(onClick = { sortMenuExpanded = true }) {
                                    Icon(
                                        AppIcons.FilterList,
                                        contentDescription = "排序方式",
                                        tint = MaterialTheme.colorScheme.onBackground,
                                        modifier = Modifier.size(20.dp),
                                    )
                                }
                                DropdownMenu(
                                    expanded = sortMenuExpanded,
                                    onDismissRequest = { sortMenuExpanded = false },
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("默认排序") },
                                        onClick = { sortMode = "default"; sortMenuExpanded = false },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("按最近更新") },
                                        onClick = { sortMode = "updated"; sortMenuExpanded = false },
                                    )
                                    DropdownMenuItem(
                                        text = { Text("按节点数量") },
                                        onClick = { sortMode = "count"; sortMenuExpanded = false },
                                    )
                                }
                            }
                        }
                    },
                )
            }

            if (feedback != null) {
                item {
                    OutlinedCardBox(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                        borderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.35f),
                        contentPadding = 10,
                    ) {
                        Text(feedback!!, fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                    }
                }
            }

            if (sortedSubs.isEmpty()) {
                item {
                    EmptyStateCard(
                        icon = AppIcons.Subscriptions,
                        title = "暂无订阅配置",
                        subtitle = "点击右下角 + 添加 HTTPS 订阅（Base64 / Clash YAML）或直接粘贴节点链接",
                        actionLabel = "添加订阅或节点",
                        onAction = onOpenImport,
                    )
                }
            } else {
                items(sortedSubs, key = { it.id }) { sub ->
                    val isActive = sub.id == activeSubId
                    val isUpdating = updatingId == sub.id
                    ProfileCard(
                        subscription = sub,
                        active = isActive,
                        updating = isUpdating,
                        busy = updatingAll || updatingId != null,
                        onOpenNodes = { onSelectSubscription(sub.id) },
                        onUpdate = {
                            scope.launch {
                                updatingId = sub.id
                                feedback = null
                                val res = refreshSubscription(sub)
                                updatingId = null
                                res.fold(
                                    onSuccess = { count -> feedback = "「${sub.name}」已更新，共 $count 个节点" },
                                    onFailure = { err ->
                                        val msg = err.message ?: "订阅更新失败"
                                        feedback = msg
                                        Runtime.appendLog("订阅「${sub.name}」更新失败：$msg", level = "error")
                                    },
                                )
                            }
                        },
                        onRename = { renameTarget = sub },
                        onDelete = { Runtime.removeSubscription(sub.id) },
                    )
                }
            }
        }

        // Bottom-right + FAB
        BrandFab(
            icon = AppIcons.Plus,
            contentDescription = "添加订阅或节点",
            onClick = onOpenImport,
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
        )
    }

    renameTarget?.let { target ->
        var text by remember(target.id) { mutableStateOf(target.name) }
        AlertDialog(
            onDismissRequest = { renameTarget = null },
            shape = RoundedCornerShape(CardRadius),
            title = { Text("重命名配置", fontWeight = FontWeight.SemiBold) },
            text = {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    label = { Text("配置名称", fontSize = 12.sp) },
                    singleLine = true,
                    shape = RoundedCornerShape(CardRadius),
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        Runtime.renameSubscription(target.id, text)
                        renameTarget = null
                    },
                    enabled = text.isNotBlank(),
                    shape = RoundedCornerShape(CardRadius),
                    colors = ButtonDefaults.buttonColors(containerColor = Purple, contentColor = Color.White),
                ) { Text("保存") }
            },
            dismissButton = { TextButton(onClick = { renameTarget = null }) { Text("取消") } },
        )
    }
}

@Composable
private fun ProfileCard(
    subscription: Subscription,
    active: Boolean,
    updating: Boolean,
    busy: Boolean,
    onOpenNodes: () -> Unit,
    onUpdate: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    val ext = LocalSuperVpnColors.current
    var menuExpanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpenNodes() },
        shape = RoundedCornerShape(CardRadius),
        colors = CardDefaults.cardColors(
            containerColor = if (active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        ),
        border = BorderStroke(
            width = if (active) 1.5.dp else 1.dp,
            color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(14.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = subscription.name,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Box {
                    IconButton(onClick = { menuExpanded = true }, modifier = Modifier.size(30.dp)) {
                        Icon(
                            AppIcons.MoreVert,
                            contentDescription = "配置菜单",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    DropdownMenu(expanded = menuExpanded, onDismissRequest = { menuExpanded = false }) {
                        DropdownMenuItem(
                            text = { Text("更新订阅") },
                            enabled = !busy,
                            onClick = { menuExpanded = false; onUpdate() },
                        )
                        DropdownMenuItem(
                            text = { Text("查看节点") },
                            onClick = { menuExpanded = false; onOpenNodes() },
                        )
                        DropdownMenuItem(
                            text = { Text("重命名") },
                            enabled = !busy,
                            onClick = { menuExpanded = false; onRename() },
                        )
                        DropdownMenuItem(
                            text = { Text("删除", color = ext.danger) },
                            enabled = !busy,
                            onClick = { menuExpanded = false; onDelete() },
                        )
                    }
                }
            }

            Spacer(Modifier.height(10.dp))

            val usage = subscription.usage
            if (usage != null) {
                val fraction = (usage.percent / 100f).coerceIn(0f, 1f)
                LinearProgressIndicator(
                    progress = { fraction },
                    modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)),
                    color = if (usage.percent >= 90f) ext.danger else MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "${NodePresentation.formatBytes(usage.used)} / ${NodePresentation.formatBytes(usage.total)} · ${NodePresentation.formatExpire(usage.expire)}",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                LinearProgressIndicator(
                    progress = { 0f },
                    modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)),
                    color = MaterialTheme.colorScheme.primary,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    text = "共 ${subscription.count} 个节点 · 订阅未提供流量配额",
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(4.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "${NodePresentation.formatRelativeTime(subscription.updatedAt)} · ${subscription.count} 个节点",
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f),
                )
                if (updating) {
                    BadgePill("更新中…")
                } else if (active) {
                    BadgePill("当前使用")
                }
            }
        }
    }
}
