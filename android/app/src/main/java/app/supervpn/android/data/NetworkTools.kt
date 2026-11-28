package app.supervpn.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.Proxy
import java.net.Socket
import java.net.URL
import kotlin.math.abs
import kotlin.math.roundToInt

data class LatencyResult(
    val status: String, // "testing" | "ok" | "failed"
    val delayMs: Int? = null,
    val message: String? = null,
    val isRealProxy: Boolean = false,
)

data class SpeedTestProgress(
    val phase: String, // "latency" | "download"
    val progress: Float = 0f,
    val latencyMs: Int? = null,
    val jitterMs: Int? = null,
    val currentBytesPerSec: Long = 0L,
    val averageBytesPerSec: Long = 0L,
    val peakBytesPerSec: Long = 0L,
    val downloadedBytes: Long = 0L,
    val totalTargetBytes: Long = 0L,
    val speedPoints: List<Long> = emptyList(),
)

data class SpeedTestResult(
    val viaProxy: Boolean,
    val nodeName: String?,
    val latencyMs: Int?,
    val jitterMs: Int?,
    val averageBytesPerSec: Long,
    val peakBytesPerSec: Long,
    val downloadedBytes: Long,
    val durationMs: Long,
    val speedPoints: List<Long> = emptyList(),
    val timestamp: Long = System.currentTimeMillis(),
    val error: String? = null,
)

data class NetworkInfo(
    val publicIp: String? = null,
    val country: String? = null,
    val countryCode: String? = null,
    val localIps: List<String> = emptyList(),
    val viaProxy: Boolean = false,
    val error: String? = null,
)

data class TrafficSample(
    val upBytesPerSec: Long = 0L,
    val downBytesPerSec: Long = 0L,
)

/** Local Clash API client (127.0.0.1:19090) for live outbound mode switch and traffic stream. */
object ClashApiClient {
    private const val BASE = "http://127.0.0.1:19090"

    fun patchMode(mode: String): Boolean {
        val clashMode = when (mode) {
            "global" -> "Global"
            "direct" -> "Direct"
            else -> "Rule"
        }
        return try {
            val conn = (URL("$BASE/configs").openConnection() as HttpURLConnection).apply {
                connectTimeout = 2000
                readTimeout = 2000
                requestMethod = "PATCH"
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
            }
            conn.outputStream.use { it.write("""{"mode":"$clashMode"}""".toByteArray(Charsets.UTF_8)) }
            val ok = conn.responseCode in 200..299
            conn.disconnect()
            ok
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Connects to the Clash API `/traffic` NDJSON stream and invokes [onSample]
     * for each real core sample until interrupted or disconnected.
     */
    fun streamTraffic(onSample: (TrafficSample) -> Unit, isActive: () -> Boolean) {
        var conn: HttpURLConnection? = null
        try {
            conn = (URL("$BASE/traffic").openConnection() as HttpURLConnection).apply {
                connectTimeout = 3000
                readTimeout = 4000
                requestMethod = "GET"
            }
            if (conn.responseCode !in 200..299) return
            BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { reader ->
                while (isActive()) {
                    val line = reader.readLine() ?: break
                    val trimmed = line.trim()
                    if (trimmed.isEmpty()) continue
                    val json = runCatching { JSONObject(trimmed) }.getOrNull() ?: continue
                    val up = json.optLong("up", 0L).coerceAtLeast(0L)
                    val down = json.optLong("down", 0L).coerceAtLeast(0L)
                    onSample(TrafficSample(up, down))
                }
            }
        } catch (_: Exception) {
            // Stream closed or core stopped
        } finally {
            conn?.disconnect()
        }
    }
}

/** Real TCP handshake latency tester with bounded concurrency. */
object LatencyTester {
    private const val TIMEOUT_MS = 3500
    private const val MAX_CONCURRENCY = 16

    suspend fun measureOne(node: Node): LatencyResult = withContext(Dispatchers.IO) {
        val start = System.nanoTime()
        try {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(node.host, node.port), TIMEOUT_MS)
            }
            val elapsedMs = ((System.nanoTime() - start) / 1_000_000L).toInt().coerceAtLeast(1)
            LatencyResult(status = "ok", delayMs = elapsedMs)
        } catch (e: Exception) {
            LatencyResult(status = "failed", message = e.message ?: "连接超时")
        }
    }

    suspend fun measureBatch(
        nodes: List<Node>,
        onStart: (String) -> Unit,
        onResult: (String, LatencyResult) -> Unit,
    ) = coroutineScope {
        val semaphore = Semaphore(MAX_CONCURRENCY)
        nodes.map { node ->
            async(Dispatchers.IO) {
                semaphore.withPermit {
                    onStart(node.id)
                    val result = measureOne(node)
                    onResult(node.id, result)
                }
            }
        }.awaitAll()
    }
}

/** Honest local & public IP inspection (never fabricates addresses). */
object NetworkInspector {
    fun getLocalIps(): List<String> {
        val ips = mutableListOf<String>()
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces() ?: return emptyList()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (!iface.isUp || iface.isLoopback || iface.isVirtual) continue
                val name = iface.name.lowercase()
                if (name.startsWith("tun") || name.startsWith("dummy") || name.startsWith("rmnet_ipa")) continue
                val addrs = iface.inetAddresses
                while (addrs.hasMoreElements()) {
                    val addr = addrs.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress && !addr.isLinkLocalAddress) {
                        val ip = addr.hostAddress ?: continue
                        if (ip != "172.19.0.1") ips += ip
                    }
                }
            }
        } catch (_: Throwable) {
        }
        return ips.distinct()
    }

    suspend fun inspect(useProxy: Boolean = false): NetworkInfo = withContext(Dispatchers.IO) {
        val localIps = getLocalIps()
        var conn: HttpURLConnection? = null
        try {
            val url = URL("https://ipwho.is/")
            val opened = if (useProxy) {
                val proxy = Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", ConfigBuilder.LOCAL_MIXED_PORT))
                url.openConnection(proxy)
            } else {
                url.openConnection()
            }
            conn = (opened as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                requestMethod = "GET"
                setRequestProperty("User-Agent", "SuperVPN-Android/0.2")
            }
            if (conn.responseCode !in 200..299) {
                return@withContext NetworkInfo(
                    localIps = localIps,
                    viaProxy = useProxy,
                    error = if (useProxy) "代理不可达（HTTP ${conn.responseCode}）" else "检测失败（HTTP ${conn.responseCode}）",
                )
            }
            val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val json = JSONObject(body)
            if (json.has("success") && !json.optBoolean("success", true)) {
                return@withContext NetworkInfo(localIps = localIps, viaProxy = useProxy, error = "出口 IP 检测不可用")
            }
            val ip = json.optString("ip").takeIf { it.isNotBlank() }
                ?: return@withContext NetworkInfo(localIps = localIps, viaProxy = useProxy, error = "未返回出口 IP")
            NetworkInfo(
                publicIp = ip,
                country = json.optString("country").takeIf { it.isNotBlank() },
                countryCode = json.optString("country_code").takeIf { it.isNotBlank() },
                localIps = localIps,
                viaProxy = useProxy,
            )
        } catch (_: Throwable) {
            NetworkInfo(
                localIps = localIps,
                viaProxy = useProxy,
                error = if (useProxy) "代理线路不通，点击重试或查看日志" else "检测失败，点击重试",
            )
        } finally {
            runCatching { conn?.disconnect() }
        }
    }
}

/**
 * Real end-to-end HTTP delay and download bandwidth tester.
 * Routes through local sing-box mixed proxy (127.0.0.1:17890) when [useProxy] is true.
 */
object SpeedTester {
    private val latencyUrls = listOf(
        "https://cp.cloudflare.com/generate_204",
        "https://www.gstatic.com/generate_204",
    )

    private fun openConnection(urlString: String, useProxy: Boolean, connectMs: Int, readMs: Int): HttpURLConnection {
        val url = URL(urlString)
        val opened = if (useProxy) {
            val proxy = Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", ConfigBuilder.LOCAL_MIXED_PORT))
            url.openConnection(proxy)
        } else {
            url.openConnection()
        }
        return (opened as HttpURLConnection).apply {
            connectTimeout = connectMs
            readTimeout = readMs
            requestMethod = "GET"
            useCaches = false
            setRequestProperty("Cache-Control", "no-cache")
            setRequestProperty("User-Agent", "SuperVPN-Android/0.2")
        }
    }

    /** Measures a single real HTTP 204 round-trip delay (supports proxy or direct). */
    suspend fun measureHttpDelay(useProxy: Boolean): LatencyResult = withContext(Dispatchers.IO) {
        var lastErr: String? = null
        for (target in latencyUrls) {
            var conn: HttpURLConnection? = null
            try {
                val start = System.nanoTime()
                conn = openConnection(target, useProxy, connectMs = 5000, readMs = 5000)
                val code = conn.responseCode
                val elapsed = ((System.nanoTime() - start) / 1_000_000L).toInt().coerceAtLeast(1)
                if (code in 200..399) {
                    return@withContext LatencyResult(status = "ok", delayMs = elapsed, isRealProxy = useProxy)
                }
                lastErr = "HTTP $code"
            } catch (e: Exception) {
                lastErr = e.message ?: "连接超时"
            } finally {
                runCatching { conn?.disconnect() }
            }
        }
        LatencyResult(status = "failed", message = lastErr ?: "测速失败", isRealProxy = useProxy)
    }

    /** Computes mean delay and mean consecutive jitter from non-empty latency samples. */
    fun computeDelayStats(samples: List<Int>): Pair<Int?, Int?> {
        if (samples.isEmpty()) return null to null
        val avg = samples.average().roundToInt()
        val jitter = if (samples.size >= 2) {
            samples.zipWithNext { a, b -> abs(b - a) }.average().roundToInt()
        } else {
            0
        }
        return avg to jitter
    }

    /**
     * Runs a real 2-phase speed test:
     * 1) 3-sample HTTP latency & jitter probe
     * 2) Streaming HTTPS download benchmark of [targetBytes] (default 10 MB)
     */
    suspend fun runDownloadTest(
        useProxy: Boolean,
        nodeName: String?,
        targetBytes: Long = 10L * 1024L * 1024L,
        onProgress: (SpeedTestProgress) -> Unit,
    ): SpeedTestResult = withContext(Dispatchers.IO) {
        val ctx = currentCoroutineContext()
        val samples = mutableListOf<Int>()
        onProgress(SpeedTestProgress(phase = "latency", progress = 0.05f, totalTargetBytes = targetBytes))

        for (i in 0 until 3) {
            if (!ctx.isActive) break
            val probe = measureHttpDelay(useProxy)
            if (probe.status == "ok" && probe.delayMs != null) {
                samples += probe.delayMs
            }
            val (avgDelay, jitter) = computeDelayStats(samples)
            onProgress(
                SpeedTestProgress(
                    phase = "latency",
                    progress = 0.05f + (i + 1) * 0.05f,
                    latencyMs = avgDelay,
                    jitterMs = jitter,
                    totalTargetBytes = targetBytes,
                )
            )
        }
        val (avgDelay, jitter) = computeDelayStats(samples)
        if (!ctx.isActive) {
            return@withContext SpeedTestResult(
                viaProxy = useProxy,
                nodeName = nodeName,
                latencyMs = avgDelay,
                jitterMs = jitter,
                averageBytesPerSec = 0L,
                peakBytesPerSec = 0L,
                downloadedBytes = 0L,
                durationMs = 0L,
                error = "测速已取消",
            )
        }

        val endpoints = listOf(
            "https://speed.cloudflare.com/__down?bytes=$targetBytes",
            "https://cachefly.cachefly.net/10mb.test",
        )
        var lastError: String? = null
        val speedPoints = mutableListOf<Long>()

        for (endpoint in endpoints) {
            if (!ctx.isActive) break
            var conn: HttpURLConnection? = null
            try {
                conn = openConnection(endpoint, useProxy, connectMs = 8000, readMs = 15000)
                val code = conn.responseCode
                if (code !in 200..299) {
                    lastError = "测速节点返回 HTTP $code"
                    continue
                }
                val startNs = System.nanoTime()
                var lastSampleNs = startNs
                var lastSampleBytes = 0L
                var totalRead = 0L
                var peakSpeed = 0L
                val buf = ByteArray(32 * 1024)
                speedPoints.clear()

                conn.inputStream.use { input ->
                    while (ctx.isActive && totalRead < targetBytes) {
                        val toRead = minOf(buf.size.toLong(), targetBytes - totalRead).toInt()
                        val n = input.read(buf, 0, toRead)
                        if (n <= 0) break
                        totalRead += n

                        val nowNs = System.nanoTime()
                        val deltaNs = nowNs - lastSampleNs
                        if (deltaNs >= 200_000_000L) {
                            val deltaBytes = totalRead - lastSampleBytes
                            val instantSpeed = (deltaBytes * 1_000_000_000L / deltaNs).coerceAtLeast(0L)
                            val totalElapsedNs = (nowNs - startNs).coerceAtLeast(1L)
                            val avgSpeed = (totalRead * 1_000_000_000L / totalElapsedNs).coerceAtLeast(0L)
                            if (instantSpeed > peakSpeed) peakSpeed = instantSpeed
                            speedPoints += instantSpeed
                            if (speedPoints.size > 40) speedPoints.removeAt(0)
                            lastSampleNs = nowNs
                            lastSampleBytes = totalRead
                            onProgress(
                                SpeedTestProgress(
                                    phase = "download",
                                    progress = (0.20f + 0.80f * (totalRead.toFloat() / targetBytes.toFloat())).coerceIn(0.20f, 1f),
                                    latencyMs = avgDelay,
                                    jitterMs = jitter,
                                    currentBytesPerSec = instantSpeed,
                                    averageBytesPerSec = avgSpeed,
                                    peakBytesPerSec = peakSpeed,
                                    downloadedBytes = totalRead,
                                    totalTargetBytes = targetBytes,
                                    speedPoints = speedPoints.toList(),
                                )
                            )
                        }
                    }
                }

                val elapsedMs = ((System.nanoTime() - startNs) / 1_000_000L).coerceAtLeast(1L)
                val avgSpeed = (totalRead * 1000L / elapsedMs).coerceAtLeast(0L)
                val finalPeak = maxOf(peakSpeed, avgSpeed)
                if (speedPoints.isEmpty() && avgSpeed > 0L) speedPoints += avgSpeed

                if (totalRead <= 0L) {
                    lastError = "未收到测速数据"
                    continue
                }

                return@withContext SpeedTestResult(
                    viaProxy = useProxy,
                    nodeName = nodeName,
                    latencyMs = avgDelay,
                    jitterMs = jitter,
                    averageBytesPerSec = avgSpeed,
                    peakBytesPerSec = finalPeak,
                    downloadedBytes = totalRead,
                    durationMs = elapsedMs,
                    speedPoints = speedPoints.toList(),
                    error = if (!ctx.isActive) "测速已中断" else null,
                )
            } catch (e: Exception) {
                lastError = if (!ctx.isActive) "测速已取消" else (e.message ?: "网络测速失败")
            } finally {
                runCatching { conn?.disconnect() }
            }
        }

        SpeedTestResult(
            viaProxy = useProxy,
            nodeName = nodeName,
            latencyMs = avgDelay,
            jitterMs = jitter,
            averageBytesPerSec = 0L,
            peakBytesPerSec = 0L,
            downloadedBytes = 0L,
            durationMs = 0L,
            error = lastError ?: if (useProxy) "代理测速失败，请检查当前节点连通性" else "直连测速失败，请检查网络连接",
        )
    }
}
