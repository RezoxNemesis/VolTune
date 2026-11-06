# HDMI Connect
New independent Android app. Java implementation, package \`com.rezox.hdmiconnect\`, built with Android Gradle 8.7.3, no DeskCast source or dependencies.

Features: USB host device scan, detection of USB Billboard failure and DisplayLink vendor IDs; monitor detection via DisplayManager; Android Presentation to render video and an offline animated test on a real registered external display; video player with sample online MP4 files, file picker and HTTPS direct URL; optional local Wi-Fi browser receiver with secret URL and HTTP Range video streaming for HDMI-connected smart TVs / sticks / PCs.

**This cannot create a physical HDMI video signal** on a USB-C port without hardware DisplayPort Alt Mode. An ordinary hub may be visible as USB data without providing video; a passive cable may be invisible to the USB scanning API. A genuine DisplayLink graphics device is an alternative with the official DisplayLink Presenter app. Browser mode needs a browser-equipped receiver on the same Wi-Fi/hotspot, not a passive monitor.

APK: GitHub Actions (branch \`hdmi-connect-standalone\`) builds the development-signed \`app-debug.apk\`. Source is entirely separate from the repository's normal main branch and applications. Only the chosen local video is temporarily served by the optional browser receiver; leave receiver disabled when not using it. Online samples require internet.


## Public APK download
This isolated branch contains only the standalone HDMI Connect Android project. It uses no VolTune application source. The public GitHub release is `hdmi-connect-public-v1.0.0`, published from branch `hdmi-connect-release`.
