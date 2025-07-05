
import asyncio
import json
import base64
import time
import logging
from typing import Dict, Set
from fastapi import WebSocket, WebSocketDisconnect

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.detection_tasks: Dict[str, asyncio.Task] = {}
        
    async def connect(self, websocket: WebSocket, client_id: str):
        try:
            await websocket.accept()
            self.active_connections[client_id] = websocket
            print(f"[WebSocket] Client {client_id} connected successfully")
            return True
        except Exception as e:
            print(f"[WebSocket] Failed to connect client {client_id}: {e}")
            return False
        
    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            print(f"[WebSocket] Client {client_id} disconnected")
        if client_id in self.detection_tasks:
            self.detection_tasks[client_id].cancel()
            del self.detection_tasks[client_id]
        
    async def send_message(self, client_id: str, message: dict):
        if client_id in self.active_connections:
            try:
                await self.active_connections[client_id].send_text(json.dumps(message))
                return True
            except Exception as e:
                print(f"[WebSocket] Error sending message to {client_id}: {e}")
                self.disconnect(client_id)
                return False
        return False

manager = ConnectionManager()

async def handle_websocket_detection(websocket: WebSocket, client_id: str):
    """Handle WebSocket detection communication with improved error handling"""
    from main import roboflow_detect
    
    print(f"[WebSocket] Starting detection handler for client {client_id}")
    
    try:
        # Send welcome message
        await manager.send_message(client_id, {
            'type': 'connection_established',
            'client_id': client_id,
            'timestamp': time.time()
        })
        
        while True:
            try:
                # Wait for frame data from client with timeout
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                frame_data = json.loads(data)
                
                if frame_data.get('type') == 'detection_frame':
                    # Process the detection
                    start_time = time.time()
                    
                    # Extract image data
                    image_str = frame_data.get('image', '')
                    if ',' in image_str:
                        base64_data = image_str.split(',')[1]
                    else:
                        base64_data = image_str
                    
                    if not base64_data:
                        await manager.send_message(client_id, {
                            'type': 'detection_result',
                            'success': False,
                            'error': 'No image data provided',
                            'processing_time': 0
                        })
                        continue
                    
                    confidence_threshold = frame_data.get('confidence_threshold', 0.5)
                    overlap_threshold = frame_data.get('overlap_threshold', 0.5)
                    road_id = frame_data.get('road_id', 1)
                    
                    try:
                        # Perform detection with timeout
                        ok, preds, error = await asyncio.wait_for(
                            asyncio.get_event_loop().run_in_executor(
                                None, roboflow_detect, base64_data, confidence_threshold, overlap_threshold, 2, 10
                            ),
                            timeout=15.0
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
                            
                            # Send response back to client
                            response = {
                                'type': 'detection_result',
                                'success': True,
                                'predictions': detections,
                                'processing_time': processing_time,
                                'road_id': road_id,
                                'timestamp': time.time()
                            }
                            
                            await manager.send_message(client_id, response)
                            
                            # Handle Arduino communication (existing logic)
                            # ... keep existing code (Arduino communication logic)
                            
                        else:
                            # Send error response
                            await manager.send_message(client_id, {
                                'type': 'detection_result',
                                'success': False,
                                'error': error or 'Detection failed',
                                'processing_time': processing_time,
                                'road_id': road_id
                            })
                            
                    except asyncio.TimeoutError:
                        await manager.send_message(client_id, {
                            'type': 'detection_result',
                            'success': False,
                            'error': 'Detection timeout',
                            'processing_time': time.time() - start_time,
                            'road_id': road_id
                        })
                        
                elif frame_data.get('type') == 'ping':
                    # Respond to ping with pong
                    await manager.send_message(client_id, {
                        'type': 'pong',
                        'timestamp': time.time()
                    })
                    
            except asyncio.TimeoutError:
                print(f"[WebSocket] Timeout waiting for message from {client_id}")
                # Send ping to check if client is still alive
                await manager.send_message(client_id, {
                    'type': 'ping',
                    'timestamp': time.time()
                })
                
            except json.JSONDecodeError as e:
                print(f"[WebSocket] JSON decode error from {client_id}: {e}")
                await manager.send_message(client_id, {
                    'type': 'error',
                    'message': 'Invalid JSON data received'
                })
                
    except WebSocketDisconnect:
        print(f"[WebSocket] Client {client_id} disconnected normally")
    except Exception as e:
        print(f"[WebSocket] Unexpected error for client {client_id}: {e}")
        try:
            await manager.send_message(client_id, {
                'type': 'error',
                'message': f'Server error: {str(e)}'
            })
        except:
            pass
    finally:
        manager.disconnect(client_id)
