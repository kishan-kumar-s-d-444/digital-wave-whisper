
import serial
import time
import json
from typing import Dict, List, Optional
import threading
import queue

class ArduinoController:
    def __init__(self, port: str = 'COM3', baud_rate: int = 9600):
        self.port = port
        self.baud_rate = baud_rate
        self.serial_connection = None
        self.connected = False
        self.command_queue = queue.Queue()
        self.response_queue = queue.Queue()
        
    def connect(self):
        """Connect to Arduino"""
        try:
            self.serial_connection = serial.Serial(self.port, self.baud_rate, timeout=1)
            time.sleep(2)  # Wait for Arduino to initialize
            self.connected = True
            print(f"Connected to Arduino on {self.port}")
            
            # Start communication thread
            self.comm_thread = threading.Thread(target=self._communication_loop, daemon=True)
            self.comm_thread.start()
            
            return True
        except Exception as e:
            print(f"Failed to connect to Arduino: {e}")
            self.connected = False
            return False
    
    def disconnect(self):
        """Disconnect from Arduino"""
        if self.serial_connection:
            self.serial_connection.close()
            self.connected = False
            print("Disconnected from Arduino")
    
    def start_traffic_system(self):
        """Start the traffic control system"""
        if self.connected:
            self.command_queue.put("START\n")
            return True
        return False
    
    def stop_traffic_system(self):
        """Stop the traffic control system"""
        if self.connected:
            self.command_queue.put("STOP\n")
            return True
        return False
    
    def update_road_data(self, road_id: int, vehicle_count: int, has_emergency: bool):
        """Update vehicle count and emergency status for a road"""
        if self.connected:
            command = f"UPDATE:{road_id}:{vehicle_count}:{str(has_emergency).lower()}\n"
            self.command_queue.put(command)
            return True
        return False
    
    def get_status(self):
        """Get current status from Arduino"""
        if self.connected:
            self.command_queue.put("STATUS\n")
            return True
        return False
    
    def _communication_loop(self):
        """Main communication loop running in separate thread"""
        while self.connected:
            try:
                # Send commands from queue
                if not self.command_queue.empty():
                    command = self.command_queue.get()
                    self.serial_connection.write(command.encode())
                    print(f"Sent to Arduino: {command.strip()}")
                
                # Read responses
                if self.serial_connection.in_waiting:
                    response = self.serial_connection.readline().decode('utf-8').strip()
                    if response:
                        print(f"Arduino response: {response}")
                        self.response_queue.put(response)
                
                time.sleep(0.1)
                
            except Exception as e:
                print(f"Communication error: {e}")
                break
    
    def get_available_ports(self):
        """Get list of available serial ports"""
        import serial.tools.list_ports
        ports = serial.tools.list_ports.comports()
        return [port.device for port in ports]

# Global Arduino controller instance
arduino_controller = ArduinoController()

def initialize_arduino(port: str = None):
    """Initialize Arduino connection with auto-detection if port not specified"""
    global arduino_controller
    
    if port:
        arduino_controller.port = port
    else:
        # Try to auto-detect Arduino
        available_ports = arduino_controller.get_available_ports()
        print(f"Available ports: {available_ports}")
        
        # Common Arduino ports
        common_ports = ['COM3', 'COM4', 'COM5', '/dev/ttyUSB0', '/dev/ttyACM0']
        
        for test_port in common_ports:
            if test_port in available_ports:
                arduino_controller.port = test_port
                break
    
    return arduino_controller.connect()

def send_traffic_data(road_data: List[Dict]):
    """Send traffic data to Arduino"""
    global arduino_controller
    
    if not arduino_controller.connected:
        return False
    
    try:
        for road in road_data:
            road_id = road.get('id', 1)
            vehicle_count = len(road.get('detections', []))
            has_emergency = road.get('hasEmergencyVehicle', False)
            
            arduino_controller.update_road_data(road_id, vehicle_count, has_emergency)
        
        return True
    except Exception as e:
        print(f"Error sending traffic data: {e}")
        return False
