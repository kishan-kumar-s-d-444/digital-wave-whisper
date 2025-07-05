
import asyncio
import json
import base64
import time
import logging
from typing import Dict, Set
from fastapi import WebSocket, WebSocketDisconnect
from arduino_controller import arduino_controller, send_traffic_data

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.detection_tasks: Dict[str, asyncio.Task] = {}
        
    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        print(f"WebSocket client {client_id} connected")
        
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
        if client_id in self.detection_tasks:
            self.detection_tasks[client_id].cancel()
            del self.detection_tasks[client_id]
        print(f"WebSocket client {client_id} disconnected")
        
    async def send_message(self, client_id: str, message: dict):
        if client_id in self.active_connections:
            try:
                await self.active_connections[client_id].send_text(json.dumps(message))
                return True
            except Exception as e:
                print(f"Error sending message to {client_id}: {e}")
                self.disconnect(client_id)
                return False
        return False

manager = ConnectionManager()

async def handle_websocket_detection(websocket: WebSocket, client_id: str):
    """Handle WebSocket detection communication"""
    from main import roboflow_detect
    
    try:
        while True:
            # Wait for frame data from client
            data = await websocket.receive_text()
            frame_data = json.loads(data)
            
            if frame_data.get('type') == 'detection_frame':
                # Process the detection
                start_time = time.time()
                
                # Extract image data
                base64_data = frame_data.get('image', '').split(',')[1] if ',' in frame_data.get('image', '') else frame_data.get('image', '')
                
                if base64_data:
                    confidence_threshold = frame_data.get('confidence_threshold', 0.5)
                    overlap_threshold = frame_data.get('overlap_threshold', 0.5)
                    road_id = frame_data.get('road_id', 1)
                    
                    # Perform detection
                    ok, preds, error = await asyncio.get_event_loop().run_in_executor(
                        None, roboflow_detect, base64_data, confidence_threshold, overlap_threshold, 2, 8
                    )
                    
                    processing_time = time.time() - start_time
                    
                    if ok:
                        # Filter valid detections
                        detections = []
                        for pred in preds:
                            if all(k in pred for k in ('class', 'confidence', 'x', 'y', 'width', 'height')):
                                detections.append({
                                    'class': pred['class'],
                                    'confidence': pred['confidence'],
                                    'x': pred['x'],
                                    'y': pred['y'],
                                    'width': pred['width'],
                                    'height': pred['height']
                                })
                        
                        # Check for emergency vehicles
                        has_emergency = any(
                            d['class'].lower() in ['ambulance', 'fire', 'police', 'emergency'] for d in detections
                        )
                        
                        # Send to Arduino if needed
                        road_data = [{
                            'id': road_id,
                            'detections': detections,
                            'hasEmergencyVehicle': has_emergency
                        }]
                        
                        # Throttle Arduino updates (every 3 seconds)
                        current_time = time.time()
                        if not hasattr(handle_websocket_detection, '_last_arduino_send'):
                            handle_websocket_detection._last_arduino_send = {}
                        
                        last_send = handle_websocket_detection._last_arduino_send.get(road_id, 0)
                        if current_time - last_send >= 3:
                            if arduino_controller.connected:
                                arduino_success = await asyncio.get_event_loop().run_in_executor(
                                    None, send_traffic_data, road_data
                                )
                                print(f"[WebSocket] Arduino data sent for road {road_id}: {arduino_success}")
                            handle_websocket_detection._last_arduino_send[road_id] = current_time
                        
                        # Send response back to client
                        response = {
                            'type': 'detection_result',
                            'success': True,
                            'predictions': detections,
                            'processing_time': processing_time,
                            'road_id': road_id,
                            'timestamp': current_time
                        }
                        
                        await manager.send_message(client_id, response)
                    else:
                        # Send error response
                        await manager.send_message(client_id, {
                            'type': 'detection_result',
                            'success': False,
                            'error': error,
                            'processing_time': processing_time,
                            'road_id': road_id
                        })
                        
            elif frame_data.get('type') == 'ping':
                # Respond to ping with pong
                await manager.send_message(client_id, {
                    'type': 'pong',
                    'timestamp': time.time()
                })
                
    except WebSocketDisconnect:
        print(f"WebSocket client {client_id} disconnected")
    except Exception as e:
        print(f"WebSocket error for client {client_id}: {e}")
        await manager.send_message(client_id, {
            'type': 'error',
            'message': str(e)
        })
