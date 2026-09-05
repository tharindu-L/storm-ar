<div align="center">

# 🌩️ STORM
### Environmental & Seismic Augmented Reality

An AR web app that overlays **live weather** and **earthquake data** onto the real world - right in your mobile browser, no app install needed.

![Made with A-Frame](https://img.shields.io/badge/A--Frame-1.2.0-EF2D5E?style=flat-square)
![AR.js](https://img.shields.io/badge/AR.js-3.4.5-2B7A78?style=flat-square)
![WebXR](https://img.shields.io/badge/WebXR-Device%20API-6C63FF?style=flat-square)
![License](https://img.shields.io/badge/status-active-brightgreen?style=flat-square)

</div>

---

## ✨ What it does

STORM has two AR modes:

| Mode | Trigger | What you see |
|------|---------|--------------|
| 🌦️ **Weather-Globe** | Point your camera at a **Hiro marker** | A live 3D weather scene - sun, clouds, rain, or storm - driven by real weather data |
| 🌍 **Quake-Grid** | Point your camera at the **floor** | A 3D grid of recent earthquakes, sized by strength and coloured by depth |

---

## ⚙️ How it works

- Built with plain **HTML, CSS, and JavaScript** — no build tools needed
- Uses **A-Frame** + **AR.js** for the marker-based weather scene
- Uses **WebXR Device API** + **Three.js** for the markerless earthquake grid
- Pulls live data from:
  - 🌤️ **Open-Meteo** - weather
  - 🌋 **USGS** - earthquakes
- Data refreshes automatically every **30 seconds**
- Hosted free on **GitHub Pages** over HTTPS (required for camera access)

---

## 📱 How to use it

1. Open the live site on your phone using **Chrome** - https://tharindu-l.github.io/storm-ar/
2. Allow camera access when prompted
3. **Weather-Globe:** show a printed/on-screen **Hiro marker** and point your camera at it
4. **Quake-Grid:** point your camera at a flat surface (floor or table) and tap to place the grid

Change the weather location with a URL parameter: ?lat=6.9271&lon=79.8612&city=Colombo


---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Markup / Style | HTML, CSS |
| 3D Scene | A-Frame 1.2.0 |
| Marker Tracking | AR.js 3.4.5 |
| Markerless AR | WebXR Device API |
| Rendering | Three.js |
| Weather Data | Open-Meteo API |
| Earthquake Data | USGS API |

---

## 👤 Author

**K W T L Padmasiri**   
Virtual and Augmented Reality
