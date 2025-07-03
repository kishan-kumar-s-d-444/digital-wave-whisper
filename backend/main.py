
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
    allow_origins=["http://localhost:8080", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Roboflow configuration
ROBOFLOW_API_KEY = "qDrma4OYH0YLt5Wh8iEp"
MODEL_ENDPOINT = "toy-vehicle-detection-te7wp/3"
ROBOFLOW_URL = f"https://detect.roboflow.com/{MODEL_ENDPOINT}"

# Startup flag
startup_complete = False

# ... keep existing code (model classes and detection endpoints)
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

        return {
            "success": True,
            "predictions": detections,
            "processing_time": processing_time
        }

    except Exception as e:
        return {"success": False, "predictions": [], "error": str(e)}

# Arduino Integration Endpoints
@app.post("/arduino/connect")
async def connect_arduino(request: ArduinoConnectionRequest):
    """Connect to Arduino controller"""
    try:
        if not startup_complete:
            return {"success": False, "message": "Backend is still starting up, please wait..."}
        
        print(f"Connection request for port: {request.port}")
        success = initialize_arduino(request.port)
        if success:
            return {"success": True, "message": "Arduino connected successfully"}
        else:
            return {"success": False, "message": "Failed to connect to Arduino. Check if Arduino is connected and running the traffic_controller.ino sketch."}
    except Exception as e:
        print(f"Arduino connection error: {e}")
        return {"success": False, "message": f"Arduino connection error: {str(e)}"}

@app.post("/arduino/disconnect")
async def disconnect_arduino():
    """Disconnect from Arduino controller"""
    try:
        arduino_controller.disconnect()
        return {"success": True, "message": "Arduino disconnected"}
    except Exception as e:
        return {"success": False, "message": f"Arduino disconnection error: {str(e)}"}

@app.post("/arduino/start")
async def start_traffic_system():
    """Start the Arduino traffic control system"""
    try:
        success = arduino_controller.start_traffic_system()
        if success:
            return {"success": True, "message": "Traffic system started"}
        else:
            return {"success": False, "message": "Failed to start traffic system - Arduino not connected"}
    except Exception as e:
        return {"success": False, "message": f"Start system error: {str(e)}"}

@app.post("/arduino/stop")
async def stop_traffic_system():
    """Stop the Arduino traffic control system"""
    try:
        success = arduino_controller.stop_traffic_system()
        if success:
            return {"success": True, "message": "Traffic system stopped"}
        else:
            return {"success": False, "message": "Failed to stop traffic system - Arduino not connected"}
    except Exception as e:
        return {"success": False, "message": f"Stop system error: {str(e)}"}

@app.post("/arduino/update_traffic")
async def update_traffic_data(request: TrafficDataRequest):
    """Send traffic data to Arduino"""
    try:
        success = send_traffic_data(request.road_data)
        if success:
            return {"success": True, "message": "Traffic data sent to Arduino"}
        else:
            return {"success": False, "message": "Failed to send traffic data - Arduino not connected"}
    except Exception as e:
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
        
        return {
            "connected": arduino_controller.connected,
            "port": arduino_controller.port,
            "available_ports": arduino_controller.get_available_ports()
        }
    except Exception as e:
        return {"success": False, "message": f"Status error: {str(e)}"}

@app.get("/")
async def root():
    return {"message": "Vehicle Detection API with Arduino Integration is running"}

@app.get("/health")
async def health_check():
    return {
        "status": "healthy", 
        "model": MODEL_ENDPOINT,
        "arduino_connected": arduino_controller.connected,
        "startup_complete": startup_complete
    }

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup with proper delays"""
    global startup_complete
    print("=== Starting Vehicle Detection API with Arduino Integration ===")
    print("Initializing backend services...")
    
    # Give the system time to fully start
    await asyncio.sleep(2)
    
    print("Backend services initialized successfully")
    print("Arduino connection will be available via web interface")
    print("=== Backend ready for connections ===")
    
    startup_complete = True
