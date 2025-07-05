
import asyncio
import json
import base64
import time
import logging
from typing import Dict
from fastapi import WebSocket, WebSocketDisconnect

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        
    async def connect(self, websocket: WebSocket, client_id: str):
        try:
            await websocket.accept()
            self.active_connections[client_id] = websocket
            print(f"[WebSocket] Client {client_id} connected")
            return True
        except Exception as e:
            print(f"[WebSocket] Failed to connect {client_id}: {e}")
            return False
        
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            print(f"[WebSocket] Client {client_id} disconnected")
        
    async def send_message(self, client_id: str, message: dict):
        if client_id in self.active_connections:
            try:
                await self.active_connections[client_id].send_text(json.dumps(message))
                return True
            except Exception as e:
                print(f"[WebSocket] Send error to {client_id}: {e}")
                self.disconnect(client_id)
                return False
        return False

manager = ConnectionManager()

async def handle_websocket_detection(websocket: WebSocket, client_id: str):
    from main import roboflow_detect
    
    print(f"[WebSocket] Starting handler for {client_id}")
    
    try:
        # Send connection confirmation
        await manager.send_message(client_id, {
            'type': 'connection_established',
            'client_id': client_id,
            'timestamp': time.time()
        })
        
        while True:
            try:
                # Wait for message with timeout
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                frame_data = json.loads(data)
                
                if frame_data.get('type') == 'detection_frame':
                    start_time = time.time()
                    
                    # Extract and validate image data
                    image_str = frame_data.get('image', '')
                    if ',' in image_str:
                        base64_data = image_str.split(',')[1]
                    else:
                        base64_data = image_str
                    
                    if not base64_data:
                        await manager.send_message(client_id, {
                            'type': 'detection_result',
                            'success': False,
                            'error': 'No image data',
                            'processing_time': 0
                        })
                        continue
                    
                    confidence_threshold = frame_data.get('confidence_threshold', 0.5)
                    overlap_threshold = frame_data.get('overlap_threshold', 0.5)
                    road_id = frame_data.get('road_id', 1)
                    
                    try:
                        # Run detection
                        ok, preds, error = await asyncio.wait_for(
                            asyncio.get_event_loop().run_in_executor(
                                None, roboflow_detect, base64_data, confidence_threshold, overlap_threshold, 2, 10
                            ),
                            timeout=10.0
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
                            
                            # Send successful response
                            await manager.send_message(client_id, {
                                'type': 'detection_result',
                                'success': True,
                                'predictions': detections,
                                'processing_time': processing_time,
                                'road_id': road_id,
                                'timestamp': time.time()
                            })
                            
                        else:
                            # Send error response
                            await manager.send_message(client_id, {
                                'type': 'detection_result',
                                'success': False,
                                'error': error or 'Detection failed',
                                'processing_time': processing_time
                            })
                            
                    except asyncio.TimeoutError:
                        await manager.send_message(client_id, {
                            'type': 'detection_result',
                            'success': False,
                            'error': 'Detection timeout',
                            'processing_time': time.time() - start_time
                        })
                        
                elif frame_data.get('type') == 'ping':
                    await manager.send_message(client_id, {
                        'type': 'pong',
                        'timestamp': time.time()
                    })
                    
            except asyncio.TimeoutError:
                # Send ping to check connection
                await manager.send_message(client_id, {
                    'type': 'ping',
                    'timestamp': time.time()
                })
                
            except json.JSONDecodeError:
                await manager.send_message(client_id, {
                    'type': 'error',
                    'message': 'Invalid JSON data'
                })
                
    except WebSocketDisconnect:
        print(f"[WebSocket] {client_id} disconnected normally")
    except Exception as e:
        print(f"[WebSocket] Error for {client_id}: {e}")
    finally:
        manager.disconnect(client_id)
