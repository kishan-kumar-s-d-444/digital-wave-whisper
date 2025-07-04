from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Dict, Optional
import base64
import requests
import time
import asyncio
from arduino_controller import arduino_controller, initialize_arduino, send_traffic_data

app = FastAPI(title="Vehicle Detection API with Arduino Integration")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Roboflow configuration
ROBOFLOW_API_KEY = "ExruF1SjptGtjyzU1rAc"
MODEL_ENDPOINT = "idp-qwteg/1"
ROBOFLOW_URL = f"https://detect.roboflow.com/{MODEL_ENDPOINT}"

# Startup flag
startup_complete = False

class DetectionParameters(BaseModel):
    confidence_threshold: float = 0.5
    overlap_threshold: float = 0.5
    opacity_threshold: float = 0.75
    label_display_mode: str = "Draw Confidence"

class Detection(BaseModel):
    class_name: str
    confidence: float
    x: float
    y: float
    width: float
    height: float

class DetectionResponse(BaseModel):
    success: bool
    detections: List[Detection]
    total_detections: int
    processing_time: float

class ArduinoConnectionRequest(BaseModel):
    port: Optional[str] = None

class TrafficDataRequest(BaseModel):
    road_data: List[Dict]

@app.post("/detect", response_model=DetectionResponse)
async def detect_objects(
    file: UploadFile = File(...),
    confidence_threshold: float = 0.5,
    overlap_threshold: float = 0.5
):
    try:
        start_time = time.time()
        image_data = await file.read()
        base64_image = base64.b64encode(image_data).decode('utf-8')

        headers = {'Content-Type': 'application/x-www-form-urlencoded'}
        params = {
            'api_key': ROBOFLOW_API_KEY,
            'confidence': confidence_threshold,
            'overlap': overlap_threshold
        }

        response = requests.post(
            ROBOFLOW_URL,
            headers=headers,
            params=params,
            data=base64_image,
            timeout=30
        )

        if response.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Roboflow API error: {response.status_code}")

        result = response.json()
        processing_time = time.time() - start_time

        detections = [
            Detection(
                class_name=pred['class'],
                confidence=pred['confidence'],
                x=pred['x'],
                y=pred['y'],
                width=pred['width'],
                height=pred['height']
            )
            for pred in result.get('predictions', [])
        ]

        return DetectionResponse(
            success=True,
            detections=detections,
            total_detections=len(detections),
            processing_time=processing_time
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {str(e)}")

@app.post("/detect_frame")
async def detect_frame(frame_data: dict):
    try:
        start_time = time.time()

        base64_data = frame_data.get('image', '').split(',')[1] if ',' in frame_data.get('image', '') else frame_data.get('image', '')
        if not base64_data:
            raise HTTPException(status_code=400, detail="No image data provided")

        confidence_threshold = frame_data.get('confidence_threshold', 0.5)
        overlap_threshold = frame_data.get('overlap_threshold', 0.5)

        headers = {'Content-Type': 'application/x-www-form-urlencoded'}
        params = {
            'api_key': ROBOFLOW_API_KEY,
            'confidence': confidence_threshold,
            'overlap': overlap_threshold
        }

        response = requests.post(
            ROBOFLOW_URL,
            headers=headers,
            params=params,
            data=base64_data,
            timeout=10
        )

        if response.status_code != 200:
            return {"success": False, "predictions": [], "error": f"API error: {response.status_code}"}

        result = response.json()
        processing_time = time.time() - start_time

        detections = [{
            'class': pred['class'],
            'confidence': pred['confidence'],
            'x': pred['x'],
            'y': pred['y'],
            'width': pred['width'],
            'height': pred['height']
        } for pred in result.get('predictions', [])]

        # Print the detections received from image processing
        print("\n🔍 DETECTIONS RECEIVED FROM IMAGE PROCESSING:")
        import pprint
        pprint.pprint(detections)

        # Prepare road data for Arduino (assuming single lane, id=1; adjust as needed)
        has_emergency = any(
            d['class'].lower() in ['ambulance', 'fire', 'police', 'emergency'] for d in detections
        )
        road_data = [{
            'id': 1,  # You may want to set this dynamically if you have multiple lanes
            'detections': detections,
            'hasEmergencyVehicle': has_emergency
        }]

        print("\n🚦 SENDING TO ARDUINO (from detect_frame):")
        pprint.pprint(road_data)

        # Send to Arduino with delay for response
        success = False
        if arduino_controller.connected:
            from time import sleep
            success = send_traffic_data(road_data)
            sleep(1.5)  # Sufficient delay for Arduino to process
        else:
            print("[ERROR] Arduino not connected. Cannot send data from detect_frame.")

        return {
            "success": True,
            "predictions": detections,
            "processing_time": processing_time,
            "arduino_sent": success
        }

    except Exception as e:
        return {"success": False, "predictions": [], "error": str(e)}

@app.get("/health")
async def health_check():
    """Health check endpoint that indicates backend readiness"""
    return {
        "status": "healthy", 
        "message": "Backend server is running",
        "model": MODEL_ENDPOINT,
        "arduino_connected": arduino_controller.connected,
        "startup_complete": startup_complete,
        "timestamp": time.time()
    }

@app.post("/arduino/connect")
async def connect_arduino(request: ArduinoConnectionRequest):
    """Connect to Arduino controller"""
    try:
        if not startup_complete:
            return {"success": False, "message": "Backend is still starting up, please wait..."}
        
        print(f"🔌 Attempting to connect Arduino on port: {request.port}")
        success = initialize_arduino(request.port)
        
        if success:
            print("✅ Arduino connection successful!")
            return {"success": True, "message": "Arduino connected successfully"}
        else:
            print("❌ Arduino connection failed!")
            return {
                "success": False, 
                "message": "Failed to connect to Arduino. Please check:\n1. Arduino is connected via USB\n2. Traffic controller sketch is uploaded\n3. Correct COM port is selected\n4. Arduino IDE Serial Monitor is closed"
            }
    except Exception as e:
        print(f"❌ Arduino connection error: {e}")
        return {"success": False, "message": f"Connection error: {str(e)}"}

@app.post("/arduino/disconnect")
async def disconnect_arduino():
    """Disconnect from Arduino controller"""
    try:
        print("🔌 Disconnecting Arduino...")
        arduino_controller.disconnect()
        print("✅ Arduino disconnected successfully")
        return {"success": True, "message": "Arduino disconnected"}
    except Exception as e:
        print(f"❌ Arduino disconnection error: {e}")
        return {"success": False, "message": f"Disconnection error: {str(e)}"}

@app.post("/arduino/start")
async def start_traffic_system():
    """Start the Arduino traffic control system"""
    try:
        if not arduino_controller.connected:
            return {"success": False, "message": "Arduino not connected. Please connect first."}
        
        print("🚦 Starting traffic control system...")
        success = arduino_controller.start_traffic_system()
        
        if success:
            print("✅ Traffic system started successfully!")
            return {"success": True, "message": "Traffic system started"}
        else:
            return {"success": False, "message": "Failed to start traffic system"}
    except Exception as e:
        print(f"❌ Start system error: {e}")
        return {"success": False, "message": f"Start error: {str(e)}"}

@app.post("/arduino/stop")
async def stop_traffic_system():
    """Stop the Arduino traffic control system"""
    try:
        if not arduino_controller.connected:
            return {"success": False, "message": "Arduino not connected"}
        
        print("🛑 Stopping traffic control system...")
        success = arduino_controller.stop_traffic_system()
        
        if success:
            print("✅ Traffic system stopped successfully!")
            return {"success": True, "message": "Traffic system stopped"}
        else:
            return {"success": False, "message": "Failed to stop traffic system"}
    except Exception as e:
        print(f"❌ Stop system error: {e}")
        return {"success": False, "message": f"Stop error: {str(e)}"}

@app.post("/arduino/update_traffic")
async def update_traffic_data(request: TrafficDataRequest):
    """Send traffic data to Arduino"""
    try:
        if not arduino_controller.connected:
            return {"success": False, "message": "Arduino not connected"}
        
        import pprint
        print("\n🔍 RAW TRAFFIC DATA RECEIVED FROM FRONTEND:")
        pprint.pprint(request.road_data)

        success = send_traffic_data(request.road_data)
        if success:
            return {"success": True, "message": "Traffic data sent to Arduino"}
        else:
            return {"success": False, "message": "Failed to send traffic data"}
    except Exception as e:
        print(f"❌ Traffic data error: {e}")
        return {"success": False, "message": f"Traffic data error: {str(e)}"}

@app.get("/arduino/status")
async def get_arduino_status():
    """Get Arduino connection and system status"""
    try:
        if not startup_complete:
            return {
                "connected": False,
                "port": "N/A",
                "available_ports": [],
                "message": "Backend starting up..."
            }
        
        available_ports = arduino_controller.get_available_ports()
        print(f"📟 Available ports: {available_ports}")
        
        return {
            "connected": arduino_controller.connected,
            "port": arduino_controller.port,
            "available_ports": available_ports,
            "message": "Status retrieved successfully"
        }
    except Exception as e:
        print(f"❌ Status error: {e}")
        return {
            "connected": False,
            "port": "Error",
            "available_ports": [],
            "message": f"Status error: {str(e)}"
        }

@app.get("/")
async def root():
    return {
        "message": "🚦 Vehicle Detection API with Arduino Traffic Control", 
        "status": "running",
        "arduino_connected": arduino_controller.connected
    }

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    global startup_complete
    print("\n" + "="*60)
    print("🚀 STARTING VEHICLE DETECTION & TRAFFIC CONTROL SYSTEM")
    print("="*60)
    print("⏳ Initializing backend services...")
    
    # Give system time to fully initialize
    await asyncio.sleep(1)
    
    print("✅ Backend services ready!")
    print("🔌 Arduino connection available via web interface")
    print("🌐 Web interface can now connect to this backend")
    print("="*60)
    print("🎯 BACKEND READY FOR CONNECTIONS")
    print("="*60 + "\n")
    
    startup_complete = True
