package app.supervpn.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.supervpn.android.data.LatencyResult
import app.supervpn.android.data.LatencyTester
import app.supervpn.android.data.Node
import app.supervpn.android.data.NodePresentation
import app.supervpn.android.data.Runtime
import app.supervpn.android.data.SpeedTester
import kotlinx.coroutines.launch

@Composable
fun NodesScreen(
    initialGroupId: String? = null,
    onOpenImport: () -> Unit,
    onSwitchConnectedNode: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val ext = LocalSuperVpnColors.current
    val data = Runtime.data
    val gridState = rememberLazyGridState()

    var selectedGroup by remember { mutableStateOf(initialGroupId ?: "all") }
    var searchVisible by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    val sortByLatency = data.settings.sortNodesByLatency
    val hideUnavailable = data.settings.hideUnavailableNodes
    var twoColumn by remember { mutableStateOf(true) }
    var menuExpanded by remember { mutableStateOf(false) }
    var detailNode by remember { mutableStateOf<Node?>(null) }

    LaunchedEffect(initialGroupId) {
        if (initialGroupId != null) selectedGroup = initialGroupId
    }

    val groupMatchedNodes = remember(data.nodes, selectedGroup, searchQuery) {
        data.nodes.filter { node ->
            val groupMatch = when (selectedGroup) {
                "all" -> true
                "manual" -> node.subscriptionId == null
                else -> node.subscriptionId == selectedGroup
            }
            val queryMatch = searchQuery.isBlank() ||
                node.name.contains(searchQuery, ignoreCase = true) ||
                node.host.contains(searchQuery, ignoreCase = true) ||
                node.protocol.contains(searchQuery, ignoreCase = true)
            groupMatch && queryMatch
        }
    }

    val hiddenUnavailableCount = remember(groupMatchedNodes, hideUnavailable, Runtime.latencies.toMap()) {
        if (!hideUnavailable) 0
        else groupMatchedNodes.count { Runtime.latencies[it.id]?.status == "failed" }
    }

    val filteredNodes = remember(groupMatchedNodes, sortByLatency, hideUnavailable, Runtime.latencies.toMap()) {
        val base = if (hideUnavailable) {
            groupMatchedNodes.filter { Runtime.latencies[it.id]?.status != "failed" }
        } else {
            groupMatchedNodes
        }
        if (sortByLatency) {
            base.sortedWith(
                compareBy<Node> { node ->
                    val lat = Runtime.latencies[node.id]
                    when {
                        lat?.status == "ok" && lat.delayMs != null -> 0
                        lat?.status == "failed" -> 2
                        else -> 1
                    }
                }.thenBy { node ->
                    val lat = Runtime.latencies[node.id]
                    if (lat?.status == "ok" && lat.delayMs != null) lat.delayMs else Int.MAX_VALUE
                }
            )
        } else {
            base
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        Column(modifier = Modifier.fillMaxSize()) {
            // Top bar
            Column(modifier = Modifier.padding(start = 14.dp, end = 10.dp, top = 12.dp)) {
                PageTopBar(
                    title = "代理",
                    badge = if (data.nodes.isNotEmpty()) "${filteredNodes.size}" else null,
                    actions = {
                        IconButton(onClick = {
                            searchVisible = !searchVisible
                            if (!searchVisible) searchQuery = ""
                        }) {
                            Icon(
                                AppIcons.Search,
                                contentDescription = "搜索节点",
                                tint = if (searchVisible) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                        IconButton(onClick = {
                            val activeId = Runtime.activeNode()?.id
                            val index = filteredNodes.indexOfFirst { it.id == activeId }
                            if (index >= 0) {
                                val targetIdx = if (hiddenUnavailableCount > 0) index + 1 else index
                                scope.launch { gridState.animateScrollToItem(targetIdx) }
                            }
                        }) {
                            Icon(
                                AppIcons.Locate,
                                contentDescription = "定位当前节点",
                                tint = MaterialTheme.colorScheme.onBackground,
                                modifier = Modifier.size(20.dp),
                            )
                        }
                        Box {
                            IconButton(onClick = { menuExpanded = true }) {
                                Icon(
                                    AppIcons.MoreVert,
                                    contentDescription = "更多选项",
                                    tint = MaterialTheme.colorScheme.onBackground,
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                            DropdownMenu(
                                expanded = menuExpanded,
                                onDismissRequest = { menuExpanded = false },
                            ) {
                                DropdownMenuItem(
                                    text = { Text("按延迟排序") },
                                    trailingIcon = if (sortByLatency) {
                                        { Icon(AppIcons.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp)) }
                                    } else null,
                                    onClick = { Runtime.setSortNodesByLatency(!sortByLatency); menuExpanded = false },
                                )
                                DropdownMenuItem(
                                    text = { Text("隐藏不可用节点") },
                                    trailingIcon = if (hideUnavailable) {
                                        { Icon(AppIcons.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp)) }
                                    } else null,
                                    onClick = { Runtime.setHideUnavailableNodes(!hideUnavailable); menuExpanded = false },
                                )
                                DropdownMenuItem(
                                    text = { Text(if (twoColumn) "切换为单列视图" else "切换为双列网格") },
                                    onClick = { twoColumn = !twoColumn; menuExpanded = false },
                                )
                                DropdownMenuItem(
                                    text = { Text("导入节点或订阅") },
                                    onClick = { menuExpanded = false; onOpenImport() },
                                )
                            }
                        }
                    },
                )
            }

            // Expandable Search Field
            if (searchVisible) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("搜索节点名称、地址或协议", fontSize = 12.sp) },
                    leadingIcon = { Icon(AppIcons.Search, contentDescription = null, modifier = Modifier.size(16.dp)) },
                    singleLine = true,
                    shape = RoundedCornerShape(CardRadius),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 6.dp),
                )
            }

            // Underline Group Tab Strip
            if (data.nodes.isNotEmpty()) {
                val tabs = buildList {
                    add("all" to "节点选择")
                    data.subscriptions.forEach { sub ->
                        add(sub.id to sub.name)
                    }
                    if (data.nodes.any { it.subscriptionId == null }) {
                        add("manual" to "手动导入")
                    }
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    tabs.forEach { (id, label) ->
                        val active = selectedGroup == id
                        Column(
                            modifier = Modifier
                                .clickable { selectedGroup = id }
                                .padding(top = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                text = label,
                                fontSize = 14.sp,
                                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                                color = if (active) MaterialTheme.colorScheme.onBackground else MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                            Spacer(Modifier.height(7.dp))
                            Box(
                                modifier = Modifier
                                    .width(if (active) 36.dp else 0.dp)
                                    .height(2.5.dp)
                                    .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(2.dp)),
                            )
                        }
                    }
                }
                HorizontalDivider(thickness = 0.8.dp, color = ext.divider)
            }

            // Node Grid
            LazyVerticalGrid(
                state = gridState,
                columns = GridCells.Fixed(if (twoColumn) 2 else 1),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 92.dp),
                horizontalArrangement = Arrangement.spacedBy(SectionGap),
                verticalArrangement = Arrangement.spacedBy(SectionGap),
            ) {
                if (data.nodes.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        EmptyStateCard(
                            icon = AppIcons.Nodes,
                            title = "还没有可用节点",
                            subtitle = "支持 HTTPS 订阅（Base64 / Clash YAML）以及 VLESS / Trojan / SS / Hysteria2 / AnyTLS 节点链接",
                            actionLabel = "立即导入",
                            onAction = onOpenImport,
                        )
                    }
                } else if (filteredNodes.isEmpty()) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        EmptyStateCard(
                            icon = AppIcons.Search,
                            title = if (hiddenUnavailableCount > 0) "已隐藏 $hiddenUnavailableCount 个不可用节点" else "没有匹配的节点",
                            subtitle = if (hiddenUnavailableCount > 0) "当前分组节点测速均超时，可点击下方按钮显示或重新测速" else "请调整搜索关键词或右上角筛选条件",
                            actionLabel = if (hiddenUnavailableCount > 0) "显示不可用节点" else null,
                            onAction = if (hiddenUnavailableCount > 0) {
                                { Runtime.setHideUnavailableNodes(false) }
                            } else null,
                        )
                    }
                } else {
                    if (hiddenUnavailableCount > 0) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f), RoundedCornerShape(CardRadius))
                                    .padding(horizontal = 12.dp, vertical = 7.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Text(
                                    text = "已隐藏 $hiddenUnavailableCount 个不可用节点" + if (sortByLatency) " · 按延迟升序" else "",
                                    fontSize = 11.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    text = "显示全部",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.clickable { Runtime.setHideUnavailableNodes(false) },
                                )
                            }
                        }
                    }
                    items(filteredNodes, key = { it.id }) { node ->
                        val selected = node.id == data.settings.selectedNodeId
                        val active = Runtime.connected && node.id == Runtime.connectedNodeId
                        val latency = Runtime.latencies[node.id]
                        ProxyGridCard(
                            node = node,
                            selected = selected,
                            active = active,
                            latency = latency,
                            compact = twoColumn,
                            onSelect = {
                                val changed = node.id != data.settings.selectedNodeId
                                Runtime.selectNode(node.id)
                                if (Runtime.connected && changed) {
                                    onSwitchConnectedNode()
                                }
                            },
                            onTest = {
                                scope.launch {
                                    Runtime.latencies[node.id] = LatencyResult("testing")
                                    val res = if (Runtime.connected && node.id == Runtime.connectedNodeId) {
                                        SpeedTester.measureHttpDelay(useProxy = true)
                                    } else {
                                        LatencyTester.measureOne(node)
                                    }
                                    Runtime.latencies[node.id] = res
                                }
                            },
                            onDetails = { detailNode = node },
                        )
                    }
                }
            }
        }

        // Bottom-right Batch Latency Test FAB (tests all nodes in current group including hidden failed ones so recovered nodes reappear)
        if (groupMatchedNodes.isNotEmpty()) {
            BrandFab(
                icon = AppIcons.Speed,
                contentDescription = "批量测速",
                loading = Runtime.testingAll,
                onClick = {
                    if (Runtime.testingAll) return@BrandFab
                    scope.launch {
                        Runtime.testingAll = true
                        try {
                            LatencyTester.measureBatch(
                                nodes = groupMatchedNodes,
                                onStart = { id -> Runtime.latencies[id] = LatencyResult("testing") },
                                onResult = { id, res -> Runtime.latencies[id] = res },
                            )
                            // If connected, refresh active node with true end-to-end proxy HTTP latency
                            val activeId = Runtime.connectedNodeId
                            if (Runtime.connected && activeId != null && groupMatchedNodes.any { it.id == activeId }) {
                                val proxyRes = SpeedTester.measureHttpDelay(useProxy = true)
                                if (proxyRes.status == "ok") {
                                    Runtime.latencies[activeId] = proxyRes
                                }
                            }
                        } finally {
                            Runtime.testingAll = false
                        }
                    }
                },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(16.dp),
            )
        }
    }

    detailNode?.let { target ->
        NodeDetailDialog(
            node = target,
            subscriptionName = data.subscriptions.firstOrNull { it.id == target.subscriptionId }?.name,
            onDismiss = { detailNode = null },
            onRename = { newName ->
                Runtime.renameNode(target.id, newName)
                detailNode = null
            },
            onDelete = {
                Runtime.removeNode(target.id)
                detailNode = null
            },
        )
    }
}

@Composable
private fun ProxyGridCard(
    node: Node,
    selected: Boolean,
    active: Boolean,
    latency: LatencyResult?,
    compact: Boolean,
    onSelect: () -> Unit,
    onTest: () -> Unit,
    onDetails: () -> Unit,
) {
    val ext = LocalSuperVpnColors.current
    val region = NodePresentation.regionCode(node.name)

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onSelect() },
        shape = RoundedCornerShape(CardRadius),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface,
        ),
        border = BorderStroke(
            width = if (selected) 1.5.dp else 1.dp,
            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 11.dp),
        ) {
            // Top Row: Node Name + Region/More
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    modifier = Modifier.weight(1f),
                ) {
                    if (active) {
                        Box(
                            modifier = Modifier
                                .size(7.dp)
                                .background(ext.success, CircleShape),
                        )
                    }
                    Text(
                        text = node.name,
                        fontSize = 13.sp,
                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = if (compact) 2 else 1,
                        minLines = if (compact) 2 else 1,
                        overflow = TextOverflow.Ellipsis,
                        lineHeight = 18.sp,
                    )
                }
                Spacer(Modifier.width(4.dp))
                Icon(
                    AppIcons.MoreVert,
                    contentDescription = "节点详情",
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                    modifier = Modifier
                        .size(16.dp)
                        .clickable { onDetails() },
                )
            }

            Spacer(Modifier.height(if (compact) 12.dp else 6.dp))

            // Protocol & Region line
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Text(
                        text = region,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = node.protocol,
                        fontSize = 11.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                }

                // Latency trigger
                Box(
                    modifier = Modifier
                        .clickable { onTest() }
                        .padding(horizontal = 4.dp, vertical = 2.dp),
                    contentAlignment = Alignment.CenterEnd,
                ) {
                    when {
                        latency == null -> Icon(
                            AppIcons.Speed,
                            contentDescription = "测试延迟",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(15.dp),
                        )
                        latency.status == "testing" -> Text(
                            "测速中",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.Medium,
                        )
                        latency.status == "ok" && latency.delayMs != null -> {
                            val color = when (NodePresentation.latencyTier(latency.delayMs)) {
                                "good" -> ext.success
                                "medium" -> ext.warning
                                else -> ext.danger
                            }
                            Text(
                                text = "${latency.delayMs} ms",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = color,
                            )
                        }
                        else -> Text(
                            "超时",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Medium,
                            color = ext.danger,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun NodeDetailDialog(
    node: Node,
    subscriptionName: String?,
    onDismiss: () -> Unit,
    onRename: (String) -> Unit,
    onDelete: () -> Unit,
) {
    val ext = LocalSuperVpnColors.current
    var name by remember { mutableStateOf(node.name) }
    var copied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    val transport = node.outbound.optJSONObject("transport")?.optString("type") ?: "tcp"
    val tlsObj = node.outbound.optJSONObject("tls")
    val security = when {
        tlsObj?.optJSONObject("reality")?.optBoolean("enabled") == true -> "Reality"
        tlsObj?.optBoolean("enabled") == true -> "TLS"
        else -> "无"
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = RoundedCornerShape(CardRadius),
        title = { Text("节点详情", fontWeight = FontWeight.SemiBold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("节点名称", fontSize = 12.sp) },
                    singleLine = true,
                    shape = RoundedCornerShape(CardRadius),
                    modifier = Modifier.fillMaxWidth(),
                )
                DetailLine("协议", node.protocol)
                DetailLine("地址", "${node.host}:${node.port}")
                DetailLine("传输 / 安全", "$transport / $security")
                DetailLine("来源", subscriptionName ?: "手动导入")
                if (node.insecureRequested) {
                    Text("该节点请求跳过证书校验（受安全设置开关控制）", fontSize = 11.sp, color = ext.warning)
                }
                if (node.rawLink != null) {
                    OutlinedButton(
                        onClick = {
                            clipboard.setText(AnnotatedString(node.rawLink))
                            copied = true
                        },
                        shape = RoundedCornerShape(CardRadius),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(AppIcons.Copy, contentDescription = null, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(if (copied) "已复制节点链接" else "复制节点链接", fontSize = 12.sp)
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onRename(name) },
                enabled = name.isNotBlank(),
                shape = RoundedCornerShape(CardRadius),
                colors = ButtonDefaults.buttonColors(containerColor = Purple, contentColor = Color.White),
            ) {
                Text("保存")
            }
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = onDelete) { Text("删除", color = ext.danger) }
                TextButton(onClick = onDismiss) { Text("关闭") }
            }
        },
    )
}

@Composable
private fun DetailLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontSize = 12.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
