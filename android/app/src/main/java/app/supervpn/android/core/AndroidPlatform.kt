package app.supervpn.android.core

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Process
import android.system.OsConstants
import app.supervpn.android.data.Runtime
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.NetworkInterface
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.Notification
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.StringBox
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.net.InterfaceAddress

/**
 * Bridges libbox to Android system APIs.
 * Every callback invoked across gomobile JNI guards against unchecked exceptions
 * so missing optional permissions never abort the native process.
 */
abstract class AndroidPlatform(private val context: Context) : PlatformInterface {
    private val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    /** Implemented by the VPN service: establishes the tunnel and returns its fd. */
    abstract fun openTunnel(options: TunOptions): Int

    /** Implemented by the VPN service: protects an outbound socket fd from VPN loop. */
    abstract fun protectSocket(fd: Int): Boolean

    override fun localDNSTransport(): LocalDNSTransport? = null

    override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

    override fun autoDetectInterfaceControl(fd: Int) {
        protectSocket(fd)
    }

    override fun openTun(options: TunOptions): Int = openTunnel(options)

    override fun writeLog(message: String) {
        runCatching { Runtime.appendLog(message) }
    }

    override fun useProcFS(): Boolean = false

    override fun findConnectionOwner(
        ipProtocol: Int,
        sourceAddress: String,
        sourcePort: Int,
        destinationAddress: String,
        destinationPort: Int,
    ): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return -1
        return try {
            val uid = connectivity.getConnectionOwnerUid(
                ipProtocol,
                InetSocketAddress(sourceAddress, sourcePort),
                InetSocketAddress(destinationAddress, destinationPort),
            )
            if (uid == Process.INVALID_UID) -1 else uid
        } catch (_: Throwable) {
            -1
        }
    }

    override fun packageNameByUid(uid: Int): String = runCatching {
        context.packageManager.getPackagesForUid(uid)?.firstOrNull() ?: ""
    }.getOrDefault("")

    override fun uidByPackageName(packageName: String): Int = runCatching {
        context.packageManager.getApplicationInfo(packageName, 0).uid
    }.getOrDefault(-1)

    private fun reportNetwork(network: Network?, capabilities: NetworkCapabilities?, listener: InterfaceUpdateListener) {
        if (network == null || capabilities == null) return
        runCatching {
            val link = connectivity.getLinkProperties(network) ?: return
            val name = link.interfaceName ?: return
            val index = runCatching { java.net.NetworkInterface.getByName(name)?.index ?: -1 }.getOrDefault(-1)
            if (index == -1) return
            val metered = !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            val constrained = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_CONGESTED)
            } else {
                false
            }
            listener.updateDefaultInterface(name, index, metered, constrained)
        }
    }

    override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        stopMonitor()
        // Immediately report the current active default network before waiting for changes
        runCatching {
            val active = connectivity.activeNetwork
            val caps = active?.let { connectivity.getNetworkCapabilities(it) }
            reportNetwork(active, caps, listener)
        }
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                reportNetwork(network, runCatching { connectivity.getNetworkCapabilities(network) }.getOrNull(), listener)
            }

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                reportNetwork(network, capabilities, listener)
            }

            override fun onLost(network: Network) {
                runCatching {
                    val active = connectivity.activeNetwork
                    if (active == null) {
                        listener.updateDefaultInterface("", -1, false, false)
                    } else {
                        reportNetwork(active, connectivity.getNetworkCapabilities(active), listener)
                    }
                }
            }
        }
        networkCallback = callback
        try {
            connectivity.registerDefaultNetworkCallback(callback)
        } catch (_: Throwable) {
            networkCallback = null
        }
    }

    override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) = stopMonitor()

    private fun stopMonitor() {
        val callback = networkCallback ?: return
        networkCallback = null
        runCatching { connectivity.unregisterNetworkCallback(callback) }
    }

    override fun getInterfaces(): NetworkInterfaceIterator {
        val result = mutableListOf<NetworkInterface>()
        val local = runCatching { java.net.NetworkInterface.getNetworkInterfaces()?.toList().orEmpty() }
            .getOrDefault(emptyList())
        @Suppress("DEPRECATION")
        val networks = runCatching { connectivity.allNetworks }.getOrDefault(emptyArray())
        for (network in networks) {
            runCatching {
                val link = connectivity.getLinkProperties(network) ?: return@runCatching
                val capabilities = connectivity.getNetworkCapabilities(network) ?: return@runCatching
                val name = link.interfaceName ?: return@runCatching
                val localInterface = local.firstOrNull { it.name == name } ?: return@runCatching
                val item = NetworkInterface()
                item.setName(name)
                item.setIndex(localInterface.index)
                item.setMTU(runCatching { localInterface.mtu }.getOrDefault(1500))
                item.setAddresses(StringArray(localInterface.interfaceAddresses.mapNotNull { it.toCleanPrefix() }))
                item.setDNSServer(StringArray(link.dnsServers.mapNotNull { it.hostAddress }))
                item.setType(
                    when {
                        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Libbox.InterfaceTypeWIFI
                        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Libbox.InterfaceTypeCellular
                        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Libbox.InterfaceTypeEthernet
                        else -> Libbox.InterfaceTypeOther
                    }
                )
                var flags = 0
                if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                    flags = flags or OsConstants.IFF_UP or OsConstants.IFF_RUNNING
                }
                if (localInterface.isLoopback) flags = flags or OsConstants.IFF_LOOPBACK
                if (localInterface.isPointToPoint) flags = flags or OsConstants.IFF_POINTOPOINT
                if (runCatching { localInterface.supportsMulticast() }.getOrDefault(false)) {
                    flags = flags or OsConstants.IFF_MULTICAST
                }
                item.setFlags(flags)
                item.setMetered(!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED))
                result += item
            }
        }
        return InterfaceArray(result)
    }

    private fun InterfaceAddress.toCleanPrefix(): String? {
        val addr = address ?: return null
        val host = if (addr is Inet6Address) {
            // Strip Android %interface zone suffix so Go netip.ParsePrefix succeeds
            runCatching { Inet6Address.getByAddress(addr.address).hostAddress }.getOrNull()
        } else {
            addr.hostAddress
        } ?: return null
        return "$host/$networkPrefixLength"
    }

    override fun underNetworkExtension(): Boolean = false

    override fun includeAllNetworks(): Boolean = false

    override fun clearDNSCache() = Unit

    override fun readWIFIState(): WIFIState? = runCatching {
        val manager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return@runCatching null
        @Suppress("DEPRECATION")
        val info = manager.connectionInfo ?: return@runCatching null
        var ssid = info.ssid ?: return@runCatching null
        if (ssid == "<unknown ssid>") return@runCatching WIFIState("", "")
        if (ssid.startsWith("\"") && ssid.endsWith("\"") && ssid.length >= 2) {
            ssid = ssid.substring(1, ssid.length - 1)
        }
        WIFIState(ssid, info.bssid ?: "")
    }.getOrNull()

    override fun systemCertificates(): StringIterator = StringArray(emptyList())

    override fun sendNotification(notification: Notification?): Unit = Unit

    fun dnsServerAddress(options: TunOptions): String? = runCatching {
        val box: StringBox? = options.getDNSServerAddress()
        box?.value
    }.getOrNull()
}
