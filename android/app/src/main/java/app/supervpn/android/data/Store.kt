package app.supervpn.android.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import android.util.Log
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Node credentials never leave the app in plain text: the state file is
 * encrypted with an AES-GCM key held by the Android keystore.
 */
class Store(context: Context) {
    private val file = File(context.filesDir, "state.enc")
    private val fallback = File(context.filesDir, "state.json")

    fun load(): AppData {
        if (!file.exists()) {
            // Never migrate plain text state forward; only report it.
            if (fallback.exists()) Log.w(TAG, "legacy plain state ignored")
            return AppData()
        }
        return try {
            AppData.fromJson(decrypt(file.readBytes()))
        } catch (e: Exception) {
            Log.e(TAG, "failed to load state", e)
            AppData()
        }
    }

    fun save(data: AppData) {
        val atomic = AtomicFile(file)
        val stream = atomic.startWrite()
        try {
            stream.write(encrypt(data.toJson()))
            atomic.finishWrite(stream)
        } catch (e: Exception) {
            atomic.failWrite(stream)
            throw e
        }
        if (fallback.exists()) fallback.delete()
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    private fun encrypt(plain: String): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return buildString {
            append("v1:")
            append(Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            append(":")
            append(Base64.encodeToString(body, Base64.NO_WRAP))
        }.toByteArray(Charsets.UTF_8)
    }

    private fun decrypt(raw: ByteArray): String {
        val text = raw.toString(Charsets.UTF_8)
        val parts = text.split(':')
        require(parts.size == 3 && parts[0] == "v1") { "unsupported state format" }
        val iv = Base64.decode(parts[1], Base64.NO_WRAP)
        val body = Base64.decode(parts[2], Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(body).toString(Charsets.UTF_8)
    }

    companion object {
        private const val TAG = "SuperVPNStore"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "supervpn-state"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
