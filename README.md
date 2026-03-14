# Wearable-Based Kinematic Analysis of Cricket Bowling 🏏

[![React](https://img.shields.io/badge/React-19-blue?style=flat&logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-green?style=flat&logo=vite)](https://vitejs.dev/)
[![Firebase](https://img.shields.io/badge/Firebase-Realtime-orange?style=flat&logo=firebase)](https://firebase.google.com/)
[![Python](https://img.shields.io/badge/Python-OpenCV%20MediaPipe-yellow?style=flat&logo=python)](https://python.org/)

## 🎯 Project Overview

**Wearable-Based Kinematic Analysis of Cricket Bowling** is a comprehensive system for real-time monitoring and analysis of cricket bowlers using wearable sensors. The system tracks joint angles (wrist, elbow, spine), acceleration, vital signs, and environmental conditions during bowling sessions.

### Key Features
- **Real-time Dashboard**: Live sensor data visualization with interactive charts
- **Smart Feedback Engine**: Bowling-type specific angle limits (Fast/Swing vs Spin)
- **Comprehensive Reports**: PDF generation for per-ball, session, and over analysis
- **Bowling Gesture Recognition**: Computer vision backend using MediaPipe (approach, backswing, release)
- **Multi-sensor Support**: 5 MPU sensors + HR, SpO2, BP, temperature, humidity
- **Session Management**: Track overs, ball speeds, consistency scores
- **Coaching Suggestions**: Technique recommendations per bowling type

## 🏗️ Architecture

```
Wearables (MPU6050 x5, Vitals) → ESP32 → Firebase RTDB → React Dashboard
                          ↓
                    Python CV Backend (Gesture Recognition)
```

## 🚀 Quick Start

### Frontend (Dashboard)
```bash
cd Wearable_Based_Kinematic_analysis_of_Cricket_bowling
npm install
npm run dev
```

### Backend (Gesture Recognition)
```bash
cd backend
pip install -r requirements.txt  # opencv-python, mediapipe
python main.py
```

## 📊 Dashboard Features

| Feature | Description |
|---------|-------------|
| **Live Charts** | 10+ real-time charts (accel, angles, vitals) |
| **Smart Alerts** | Real-time technique feedback |
| **PDF Reports** | Per-ball, session, over analysis |
| **Bowling Types** | Fast, Swing, Off Spin, Leg Spin, Yorker, Bouncer |
| **Over Tracking** | Automatic 6-ball over analysis |

## 🔧 Sensor Configuration

```
1_Temp    → Temperature (°C)
2_Hum     → Humidity (%)
3_MPU_1   → Wrist (Accel, Angle)
4_MPU_2   → Elbow (Accel, Angle) 
5_MPU_3   → Spine (Accel, Angle)
6_HR      → Heart Rate (bpm)
7_SPO2    → Blood Oxygen (%)
8_BP      → Blood Pressure (sys/dia)
```

## 📈 Smart Feedback Limits

| Bowling Type | Wrist | Elbow | Spine |
|-------------|-------|-------|-------|
| Fast/Swing/Yorker/Bouncer | 90°–220° | 45°–180° | 180°–200° |
| Off/Leg Spin | 180°–230° | 90°–250° | 180°–230° |

## 🖼️ Screenshots

**[Add screenshots here after running `npm run dev`]**

## 🚀 Backend Features

**main.py** - Real-time bowling gesture recognition:
- Approach stance detection
- Backswing motion analysis  
- Forward swing tracking
- Ball release identification
- Follow-through validation
- Frame counting via hand gestures

## 📱 Firebase Structure

```
Cricket_Bowler/
├── 1_Sensor_Data/     (live readings)
├── _node              (device status)
├── _bowling_type      (current mode)
├── ball_stats/        (count, speed)
└── sessions/          (historical data)
```

## 🔍 Reports Generated

1. **Per-Ball Report**: Speed, angles, vitals snapshot, safety check
2. **Session Report**: Consistency score, stamina, over summary
3. **Over Report**: 6-ball performance, avg/top speed

## 🛠️ Development

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Build for production
npm run build

# Lint
npm run lint
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) file.

## 👥 Authors

- **Primary Developer**: Built with React 19 + Vite 7
- **Backend CV**: MediaPipe + OpenCV gesture recognition

---

**Wearable Cricket Bowling Analysis** - Professional kinematic monitoring for bowlers! 🏏📊


=======
# Wearable_Based_kinematic_analysis_of_Cricket_Bowling_Anlysis-
>>>>>>> 879a32065cc7a0562ddb5d77bfa2e32e6acff575
