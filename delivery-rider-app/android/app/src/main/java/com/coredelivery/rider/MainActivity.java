package com.coredelivery.rider;

import android.os.Bundle;
import android.os.PowerManager;
import android.content.Context;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private PowerManager.WakeLock cpuWakeLock;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Acquire a partial wake lock to keep CPU alive when screen is off
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            cpuWakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "coredelivery:tracking"
            );
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Acquire CPU wake lock when app is active
        if (cpuWakeLock != null && !cpuWakeLock.isHeld()) {
            cpuWakeLock.acquire(8 * 60 * 60 * 1000L); // 8 hours max (full shift)
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Keep CPU wake lock held — allows JS timers and GPS to run in background
        // Wake lock is released in onDestroy when app is fully closed
    }

    @Override
    protected void onDestroy() {
        if (cpuWakeLock != null && cpuWakeLock.isHeld()) {
            cpuWakeLock.release();
        }
        super.onDestroy();
    }
}
