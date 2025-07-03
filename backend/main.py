from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List
import base64
import requests
import time

app = FastAPI(title="Vehicle Detection API")

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

@app.get("/")
async def root():
    return {"message": "Vehicle Detection API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy", "model": MODEL_ENDPOINT}
