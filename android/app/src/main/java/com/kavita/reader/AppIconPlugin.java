package com.kavita.reader;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {
    private static final String TAG = "AppIconPlugin";

    private static final String ICON_CLASSIC = "classic";
    private static final String ICON_EMBLEM = "emblem";

    private ComponentName getClassicComponent(Context ctx) {
        return new ComponentName(ctx.getPackageName(), ctx.getPackageName() + ".MainActivityClassic");
    }

    private ComponentName getEmblemComponent(Context ctx) {
        return new ComponentName(ctx.getPackageName(), ctx.getPackageName() + ".MainActivityEmblem");
    }

    @PluginMethod
    public void getAppIcon(PluginCall call) {
        try {
            Context ctx = getContext();
            PackageManager pm = ctx.getPackageManager();

            ComponentName emblem = getEmblemComponent(ctx);
            int emblemState = pm.getComponentEnabledSetting(emblem);

            String currentIcon = ICON_CLASSIC;
            if (emblemState == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
                currentIcon = ICON_EMBLEM;
            }

            JSObject ret = new JSObject();
            ret.put("icon", currentIcon);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error getting app icon", e);
            JSObject ret = new JSObject();
            ret.put("icon", ICON_CLASSIC);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void setAppIcon(PluginCall call) {
        String targetIcon = call.getString("icon");
        if (targetIcon == null || (!targetIcon.equals(ICON_CLASSIC) && !targetIcon.equals(ICON_EMBLEM))) {
            call.reject("Invalid icon name. Supported icons: 'classic', 'emblem'");
            return;
        }

        Context ctx = getContext();
        PackageManager pm = ctx.getPackageManager();
        ComponentName classic = getClassicComponent(ctx);
        ComponentName emblem = getEmblemComponent(ctx);

        ComponentName targetComponent = targetIcon.equals(ICON_EMBLEM) ? emblem : classic;
        ComponentName oldComponent = targetIcon.equals(ICON_EMBLEM) ? classic : emblem;

        // 若目標已處於啟用狀態，直接返回，避免重複觸發系統 PackageManager 重載
        int targetState = pm.getComponentEnabledSetting(targetComponent);
        if (targetState == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) {
            Log.i(TAG, "Target icon " + targetIcon + " is already active. Skipping operation.");
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("icon", targetIcon);
            call.resolve(ret);
            return;
        }

        try {
            // Anti-vanish sequence: Enable new component first, then disable old component
            pm.setComponentEnabledSetting(
                targetComponent,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            );

            pm.setComponentEnabledSetting(
                oldComponent,
                PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP
            );

            Log.i(TAG, "App icon switched successfully to " + targetIcon);
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("icon", targetIcon);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to switch app icon, applying fallback recovery", e);
            // Safety recovery: ensure at least classic is enabled
            try {
                pm.setComponentEnabledSetting(
                    classic,
                    PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                    PackageManager.DONT_KILL_APP
                );
            } catch (Exception recEx) {
                Log.e(TAG, "Critical error recovering default icon", recEx);
            }
            call.reject("Failed to change app icon: " + e.getMessage());
        }
    }
}
