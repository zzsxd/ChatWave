package io.chatwave.android;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import com.getcapacitor.CapConfig;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String CHATWAVE_URL =
        "https://app.chatwave.62-113-44-238.sslip.io/";
    private AudioManager audioManager;
    private AudioFocusRequest callAudioFocusRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        config = new CapConfig.Builder(this)
            .setServerUrl(CHATWAVE_URL)
            .setAllowNavigation(new String[] {
                "app.chatwave.62-113-44-238.sslip.io"
            })
            .setErrorPath("index.html")
            .setAppendedUserAgentString(" ChatWave-Android/1.0")
            .setBackgroundColor("#080d17")
            .setAllowMixedContent(false)
            .setCaptureInput(true)
            .setInitialFocus(true)
            .setWebContentsDebuggingEnabled(false)
            .setLoggingEnabled(false)
            .create();

        super.onCreate(savedInstanceState);

        // Some vendor WebView implementations (notably Huawei) can finish
        // provider initialization after Activity creation. Capacitor already
        // configures persistent cookies, so no direct CookieManager access is
        // needed here. Keep the cosmetic setup null-safe.
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setBackgroundColor(
                android.graphics.Color.rgb(8, 13, 23)
            );
            // WebRTC audio arrives after the tap that starts or accepts a
            // call. Vendor WebViews may otherwise treat it as unprompted
            // autoplay and keep the remote participant silent.
            bridge
                .getWebView()
                .getSettings()
                .setMediaPlaybackRequiresUserGesture(false);
            bridge.getWebView().addJavascriptInterface(
                new ChatWaveAndroidBridge(),
                "ChatWaveAndroid"
            );
        }
    }

    private void setCallAudioActive(boolean active) {
        if (audioManager == null) {
            audioManager = (AudioManager) getSystemService(
                Context.AUDIO_SERVICE
            );
        }
        if (audioManager == null) return;

        if (active) {
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            requestCallAudioFocus();
            routeCallToSpeaker();
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice();
        } else {
            audioManager.setSpeakerphoneOn(false);
        }
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            callAudioFocusRequest != null
        ) {
            audioManager.abandonAudioFocusRequest(callAudioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(null);
        }
        audioManager.setMode(AudioManager.MODE_NORMAL);
    }

    private void requestCallAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
            callAudioFocusRequest = new AudioFocusRequest.Builder(
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            )
                .setAudioAttributes(attributes)
                .build();
            audioManager.requestAudioFocus(callAudioFocusRequest);
        } else {
            audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            );
        }
    }

    private void routeCallToSpeaker() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            for (
                AudioDeviceInfo device :
                    audioManager.getAvailableCommunicationDevices()
            ) {
                if (device.getType() == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    audioManager.setCommunicationDevice(device);
                    return;
                }
            }
        }
        audioManager.setSpeakerphoneOn(true);
    }

    @Override
    public void onDestroy() {
        setCallAudioActive(false);
        super.onDestroy();
    }

    private final class ChatWaveAndroidBridge {
        @JavascriptInterface
        public void setCallActive(boolean active) {
            runOnUiThread(() -> setCallAudioActive(active));
        }
    }
}
