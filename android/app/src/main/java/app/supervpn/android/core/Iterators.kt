package app.supervpn.android.core

import io.nekohasekai.libbox.NetworkInterface
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.RoutePrefix
import io.nekohasekai.libbox.RoutePrefixIterator
import io.nekohasekai.libbox.StringIterator

class StringArray(private val values: List<String>) : StringIterator {
    private var index = 0
    override fun len(): Int = values.size
    override fun hasNext(): Boolean = index < values.size
    override fun next(): String = if (index < values.size) values[index++] else ""
}

class InterfaceArray(private val values: List<NetworkInterface>) : NetworkInterfaceIterator {
    private var index = 0
    override fun hasNext(): Boolean = index < values.size
    override fun next(): NetworkInterface = values[index++]
}

class PrefixArray(private val values: List<RoutePrefix>) : RoutePrefixIterator {
    private var index = 0
    override fun hasNext(): Boolean = index < values.size
    override fun next(): RoutePrefix = values[index++]
}
