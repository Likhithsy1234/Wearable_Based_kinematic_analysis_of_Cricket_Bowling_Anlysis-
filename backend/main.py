import cv2
import time
import os
import numpy as np
import json
import logging
from datetime import datetime

# Optional imports for accessibility features
try:
    import mediapipe as mp
    MEDIAPIPE_AVAILABLE = True
    print("✓ MediaPipe loaded")
except ImportError as e:
    MEDIAPIPE_AVAILABLE = False
    print(f"⚠️ Bowling gesture detection not available: {e}")
    print("Install with: pip install mediapipe")

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class BowlingGestureRecognizer:
    def __init__(self, frame_width=640, frame_height=480):
        self.frame_width = frame_width
        self.frame_height = frame_height
        
        # Bowling gesture states
        self.bowling_gestures = {
            'approach': 'Bowling Approach Stance',
            'backswing': 'Backswing Motion',
            'forward_swing': 'Forward Swing',
            'release': 'Ball Release',
            'follow_through': 'Follow Through',
            'aim': 'Aiming Position',
            'spare_shot': 'Spare Shot Preparation',
            'strike_celebration': 'Strike Celebration',
            'frame_count': 'Frame/Score Indication'
        }
        
        # Gesture detection parameters
        self.last_gesture = None
        self.gesture_confidence = 0.0
        self.gesture_history = []
        self.max_history = 10
        
        # Bowling specific tracking
        self.arm_angle_history = []
        self.hand_position_history = []
        self.body_stance_state = None
        
        # Initialize MediaPipe
        self.init_mediapipe()
        
    def init_mediapipe(self):
        """Initialize MediaPipe components for bowling gesture detection"""
        if not MEDIAPIPE_AVAILABLE:
            logger.error("❌ MediaPipe not available for bowling gesture detection")
            self.mediapipe_ready = False
            return
            
        try:
            # Initialize pose detection for body stance
            self.mp_pose = mp.solutions.pose
            self.pose = self.mp_pose.Pose(
                static_image_mode=False,
                model_complexity=1,
                enable_segmentation=False,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5
            )
            
            # Initialize hand detection for bowling hand gestures
            self.mp_hands = mp.solutions.hands
            self.hands = self.mp_hands.Hands(
                static_image_mode=False,
                max_num_hands=2,
                min_detection_confidence=0.7,
                min_tracking_confidence=0.5
            )
            
            self.mp_drawing = mp.solutions.drawing_utils
            self.mediapipe_ready = True
            logger.info("✓ MediaPipe initialized for bowling gesture detection")
            
        except Exception as e:
            logger.error(f"❌ MediaPipe initialization failed: {e}")
            self.mediapipe_ready = False

    def detect_bowling_gestures(self, frame):
        """Main function to detect bowling-specific gestures"""
        if not self.mediapipe_ready:
            return frame, None
            
        try:
            # Convert BGR to RGB
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Process pose and hands
            pose_results = self.pose.process(rgb_frame)
            hand_results = self.hands.process(rgb_frame)
            
            # Detect bowling gestures
            gesture = self.analyze_bowling_movement(pose_results, hand_results, frame.shape)
            
            # Draw annotations
            annotated_frame = self.draw_bowling_annotations(frame, pose_results, hand_results, gesture)
            
            return annotated_frame, gesture
            
        except Exception as e:
            logger.error(f"❌ Bowling gesture detection error: {e}")
            return frame, None

    def analyze_bowling_movement(self, pose_results, hand_results, frame_shape):
        """Analyze pose and hand landmarks to detect bowling gestures"""
        try:
            gesture = None
            confidence = 0.0
            
            if pose_results.pose_landmarks and hand_results.multi_hand_landmarks:
                # Get pose landmarks
                pose_landmarks = pose_results.pose_landmarks.landmark
                
                # Get dominant hand (bowling hand)
                bowling_hand = self.get_bowling_hand(hand_results, pose_landmarks)
                
                if bowling_hand:
                    # Analyze arm position and movement
                    arm_angle = self.calculate_arm_angle(pose_landmarks)
                    hand_position = self.get_hand_position(bowling_hand)
                    body_stance = self.analyze_body_stance(pose_landmarks)
                    
                    # Store history for movement analysis
                    self.arm_angle_history.append(arm_angle)
                    self.hand_position_history.append(hand_position)
                    
                    # Keep only recent history
                    if len(self.arm_angle_history) > self.max_history:
                        self.arm_angle_history.pop(0)
                        self.hand_position_history.pop(0)
                    
                    # Detect specific bowling gestures
                    gesture, confidence = self.classify_bowling_gesture(
                        arm_angle, hand_position, body_stance, 
                        self.arm_angle_history, self.hand_position_history
                    )
            
            elif hand_results.multi_hand_landmarks:
                # Hand-only gestures (for frame counting, etc.)
                gesture, confidence = self.detect_hand_only_gestures(hand_results)
            
            # Update gesture with confidence threshold
            if confidence > 0.6:
                self.last_gesture = gesture
                self.gesture_confidence = confidence
                self.update_gesture_history(gesture)
                return gesture
            
            return self.last_gesture if self.gesture_confidence > 0.4 else None
            
        except Exception as e:
            logger.error(f"❌ Bowling movement analysis error: {e}")
            return None

    def get_bowling_hand(self, hand_results, pose_landmarks):
        """Determine which hand is the bowling hand based on position"""
        try:
            if not hand_results.multi_hand_landmarks:
                return None
                
            # For simplicity, use the right hand as bowling hand
            # In a real application, you could detect based on movement patterns
            for hand_landmarks in hand_results.multi_hand_landmarks:
                return hand_landmarks
                
            return None
        except Exception as e:
            logger.error(f"❌ Bowling hand detection error: {e}")
            return None

    def calculate_arm_angle(self, pose_landmarks):
        """Calculate the angle of the bowling arm"""
        try:
            # Get shoulder, elbow, and wrist positions (right side)
            shoulder = pose_landmarks[self.mp_pose.PoseLandmark.RIGHT_SHOULDER]
            elbow = pose_landmarks[self.mp_pose.PoseLandmark.RIGHT_ELBOW]
            wrist = pose_landmarks[self.mp_pose.PoseLandmark.RIGHT_WRIST]
            
            # Calculate angle between shoulder-elbow and elbow-wrist
            v1 = np.array([shoulder.x - elbow.x, shoulder.y - elbow.y])
            v2 = np.array([wrist.x - elbow.x, wrist.y - elbow.y])
            
            # Calculate angle
            angle = np.arccos(np.clip(np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2)), -1.0, 1.0))
            return np.degrees(angle)
            
        except Exception as e:
            logger.error(f"❌ Arm angle calculation error: {e}")
            return 0

    def get_hand_position(self, hand_landmarks):
        """Get normalized hand position"""
        try:
            # Get wrist position as reference
            wrist = hand_landmarks.landmark[0]  # Wrist landmark
            return {'x': wrist.x, 'y': wrist.y, 'z': wrist.z}
        except Exception as e:
            logger.error(f"❌ Hand position error: {e}")
            return {'x': 0, 'y': 0, 'z': 0}

    def analyze_body_stance(self, pose_landmarks):
        """Analyze body stance for bowling position"""
        try:
            # Get key body landmarks
            left_shoulder = pose_landmarks[self.mp_pose.PoseLandmark.LEFT_SHOULDER]
            right_shoulder = pose_landmarks[self.mp_pose.PoseLandmark.RIGHT_SHOULDER]
            left_hip = pose_landmarks[self.mp_pose.PoseLandmark.LEFT_HIP]
            right_hip = pose_landmarks[self.mp_pose.PoseLandmark.RIGHT_HIP]
            left_knee = pose_landmarks[self.mp_pose.PoseLandmark.LEFT_KNEE]
            right_knee = pose_landmarks[self.mp_pose.PoseLandmark.RIGHT_KNEE]
            
            # Calculate body alignment
            shoulder_slope = (right_shoulder.y - left_shoulder.y) / (right_shoulder.x - left_shoulder.x + 0.001)
            hip_slope = (right_hip.y - left_hip.y) / (right_hip.x - left_hip.x + 0.001)
            
            # Determine stance
            if abs(shoulder_slope) < 0.1 and abs(hip_slope) < 0.1:
                return "balanced"
            elif right_shoulder.y < left_shoulder.y:
                return "leaning_right"
            else:
                return "leaning_left"
                
        except Exception as e:
            logger.error(f"❌ Body stance analysis error: {e}")
            return "unknown"

    def classify_bowling_gesture(self, arm_angle, hand_position, body_stance, arm_history, hand_history):
        """Classify the bowling gesture based on analyzed parameters"""
        try:
            gesture = None
            confidence = 0.0
            
            # Approach stance - balanced body, arm at side
            if (body_stance == "balanced" and 
                160 <= arm_angle <= 180 and 
                0.4 <= hand_position['y'] <= 0.7):
                gesture = "approach"
                confidence = 0.8
            
            # Backswing - arm moving backwards and up
            elif (arm_angle > 120 and hand_position['y'] < 0.4):
                if len(arm_history) >= 3:
                    # Check if arm is moving upward in recent frames
                    recent_positions = [pos['y'] for pos in hand_history[-3:]]
                    if all(recent_positions[i] >= recent_positions[i+1] for i in range(len(recent_positions)-1)):
                        gesture = "backswing"
                        confidence = 0.9
            
            # Forward swing - arm moving forward and down
            elif (60 <= arm_angle <= 120 and 0.3 <= hand_position['y'] <= 0.8):
                if len(hand_history) >= 3:
                    recent_positions = [pos['y'] for pos in hand_history[-3:]]
                    if all(recent_positions[i] <= recent_positions[i+1] for i in range(len(recent_positions)-1)):
                        gesture = "forward_swing"
                        confidence = 0.9
            
            # Release - arm extended forward, hand low
            elif (arm_angle > 140 and hand_position['y'] > 0.6):
                gesture = "release"
                confidence = 0.8
            
            # Follow through - arm high and forward
            elif (arm_angle < 90 and hand_position['y'] < 0.3):
                gesture = "follow_through"
                confidence = 0.7
            
            # Aiming position - arm at side, body aligned
            elif (body_stance == "balanced" and 
                  150 <= arm_angle <= 180 and 
                  0.3 <= hand_position['y'] <= 0.6):
                gesture = "aim"
                confidence = 0.6
            
            return gesture, confidence
            
        except Exception as e:
            logger.error(f"❌ Gesture classification error: {e}")
            return None, 0.0

    def detect_hand_only_gestures(self, hand_results):
        """Detect gestures using only hand landmarks (like finger counting for frames)"""
        try:
            if not hand_results.multi_hand_landmarks:
                return None, 0.0
                
            for hand_landmarks in hand_results.multi_hand_landmarks:
                # Count fingers for frame/score indication
                finger_count = self.count_fingers(hand_landmarks)
                
                if finger_count > 0:
                    return f"frame_count_{finger_count}", 0.8
                    
            return None, 0.0
            
        except Exception as e:
            logger.error(f"❌ Hand-only gesture detection error: {e}")
            return None, 0.0

    def count_fingers(self, hand_landmarks):
        """Count extended fingers for frame/score indication"""
        try:
            landmarks = hand_landmarks.landmark
            
            # Finger tip and pip landmark indices
            finger_tips = [4, 8, 12, 16, 20]  # Thumb, Index, Middle, Ring, Pinky
            finger_pips = [3, 6, 10, 14, 18]  # PIP joints
            finger_mcps = [2, 5, 9, 13, 17]   # MCP joints
            
            fingers_up = 0
            
            # Check each finger
            for i in range(5):
                if i == 0:  # Thumb - check horizontal extension
                    thumb_tip = landmarks[finger_tips[i]]
                    thumb_mcp = landmarks[finger_mcps[i]]
                    thumb_distance = abs(thumb_tip.x - thumb_mcp.x)
                    if thumb_distance > 0.04:
                        fingers_up += 1
                else:  # Other fingers - check vertical extension
                    tip_y = landmarks[finger_tips[i]].y
                    pip_y = landmarks[finger_pips[i]].y
                    if tip_y < pip_y:
                        fingers_up += 1
            
            return fingers_up
            
        except Exception as e:
            logger.error(f"❌ Finger counting error: {e}")
            return 0

    def update_gesture_history(self, gesture):
        """Update gesture history for pattern analysis"""
        self.gesture_history.append({
            'gesture': gesture,
            'timestamp': time.time(),
            'confidence': self.gesture_confidence
        })
        
        # Keep only recent history
        if len(self.gesture_history) > self.max_history:
            self.gesture_history.pop(0)

    def draw_bowling_annotations(self, frame, pose_results, hand_results, gesture):
        """Draw bowling-specific annotations on the frame"""
        try:
            # Draw pose landmarks
            if pose_results.pose_landmarks:
                self.mp_drawing.draw_landmarks(
                    frame, pose_results.pose_landmarks, self.mp_pose.POSE_CONNECTIONS)
            
            # Draw hand landmarks
            if hand_results.multi_hand_landmarks:
                for hand_landmarks in hand_results.multi_hand_landmarks:
                    self.mp_drawing.draw_landmarks(
                        frame, hand_landmarks, self.mp_hands.HAND_CONNECTIONS)
            
            # Display current gesture
            if gesture:
                gesture_text = self.bowling_gestures.get(gesture.split('_')[0], gesture)
                cv2.putText(frame, f"Bowling Action: {gesture_text}", 
                           (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
                cv2.putText(frame, f"Confidence: {self.gesture_confidence:.2f}", 
                           (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 0), 2)
            
            # Display instructions
            instructions = [
                "Bowling Gesture Recognition:",
                "- Stand in approach position",
                "- Perform backswing motion", 
                "- Execute forward swing",
                "- Show fingers for frame count",
                "- Celebrate strikes!"
            ]
            
            for i, instruction in enumerate(instructions):
                cv2.putText(frame, instruction, 
                           (10, frame.shape[0] - 120 + i*20),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            
            return frame
            
        except Exception as e:
            logger.error(f"❌ Annotation drawing error: {e}")
            return frame

    def get_gesture_feedback(self, gesture):
        """Provide feedback for bowling gestures"""
        feedback_messages = {
            'approach': "Good approach stance! Keep your body balanced.",
            'backswing': "Nice backswing! Keep it smooth and controlled.",
            'forward_swing': "Great forward swing! Focus on accuracy.",
            'release': "Perfect release position! Follow through now.",
            'follow_through': "Excellent follow through! Well done!",
            'aim': "Take your time to aim. Focus on your target.",
            'frame_count_1': "Frame 1 detected",
            'frame_count_2': "Frame 2 detected", 
            'frame_count_3': "Frame 3 detected",
            'frame_count_4': "Frame 4 detected",
            'frame_count_5': "Frame 5 detected",
            'frame_count_10': "10th Frame detected"
        }
        
        return feedback_messages.get(gesture, f"Bowling gesture detected: {gesture}")

def main():
    """Main function to run bowling gesture recognition"""
    # Initialize the bowling gesture recognizer
    bowling_recognizer = BowlingGestureRecognizer()
    
    # Initialize camera
    cap = cv2.VideoCapture(1)
    
    if not cap.isOpened():
        logger.error("❌ Cannot open camera")
        return
    
    logger.info("🎳 Starting Bowling Gesture Recognition...")
    logger.info("Press 'q' to quit, 'r' to reset gesture history")
    
    while True:
        ret, frame = cap.read()
        if not ret:
            logger.error("❌ Failed to read from camera")
            break
        
        # Flip frame horizontally for mirror effect
        frame = cv2.flip(frame, 1)
        
        # Detect bowling gestures
        annotated_frame, gesture = bowling_recognizer.detect_bowling_gestures(frame)
        
        # Display the frame
        cv2.imshow('Bowling Gesture Recognition', annotated_frame)
        
        # Print gesture feedback
        if gesture:
            feedback = bowling_recognizer.get_gesture_feedback(gesture)
            print(f"🎳 {feedback}")
        
        # Handle key presses
        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('r'):
            bowling_recognizer.gesture_history.clear()
            bowling_recognizer.arm_angle_history.clear()
            bowling_recognizer.hand_position_history.clear()
            print("🔄 Gesture history reset")
    
    # Cleanup
    cap.release()
    cv2.destroyAllWindows()
    logger.info("🎳 Bowling Gesture Recognition ended")

if __name__ == "__main__":
    main()