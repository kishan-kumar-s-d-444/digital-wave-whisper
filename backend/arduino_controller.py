
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
        self.comm_thread = None
        
    def connect(self):
        """Connect to Arduino with proper delays"""
        try:
            print(f"Attempting to connect to Arduino on {self.port}...")
            self.serial_connection = serial.Serial(self.port, self.baud_rate, timeout=2)
            
            # Give Arduino more time to initialize
            print("Waiting for Arduino to initialize...")
            time.sleep(4)  # Increased delay for Arduino initialization
            
            # Clear any initial data
            if self.serial_connection.in_waiting:
                self.serial_connection.reset_input_buffer()
            
            self.connected = True
            print(f"Successfully connected to Arduino on {self.port}")
            
            # Start communication thread
            self.comm_thread = threading.Thread(target=self._communication_loop, daemon=True)
            self.comm_thread.start()
            
            # Send a test command to verify connection
            time.sleep(1)
            self.command_queue.put("STATUS\n")
            
            return True
        except Exception as e:
            print(f"Failed to connect to Arduino: {e}")
            self.connected = False
            if self.serial_connection:
                try:
                    self.serial_connection.close()
                except:
                    pass
                self.serial_connection = None
            return False
    
    def disconnect(self):
        """Disconnect from Arduino"""
        self.connected = False
        if self.serial_connection:
            try:
                # Send stop command before disconnecting
                self.command_queue.put("STOP\n")
                time.sleep(1)  # Give time for command to be sent
                self.serial_connection.close()
            except:
                pass
            self.serial_connection = None
        print("Disconnected from Arduino")
    
    def start_traffic_system(self):
        """Start the traffic control system"""
        if self.connected:
            print("Starting traffic system...")
            self.command_queue.put("START\n")
            return True
        return False
    
    def stop_traffic_system(self):
        """Stop the traffic control system"""
        if self.connected:
            print("Stopping traffic system...")
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
        print("Arduino communication loop started")
        while self.connected and self.serial_connection:
            try:
                # Send commands from queue
                if not self.command_queue.empty():
                    command = self.command_queue.get()
                    self.serial_connection.write(command.encode())
                    print(f"Sent to Arduino: {command.strip()}")
                    time.sleep(0.2)  # Small delay after sending
                
                # Read responses
                if self.serial_connection.in_waiting:
                    response = self.serial_connection.readline().decode('utf-8').strip()
                    if response:
                        print(f"Arduino response: {response}")
                        self.response_queue.put(response)
                
                time.sleep(0.1)
                
            except Exception as e:
                print(f"Communication error: {e}")
                if self.connected:
                    print("Attempting to reconnect...")
                    time.sleep(2)
                    try:
                        if self.serial_connection:
                            self.serial_connection.close()
                        self.connect()
                    except:
                        break
                else:
                    break
        print("Arduino communication loop ended")
    
    def get_available_ports(self):
        """Get list of available serial ports"""
        try:
            import serial.tools.list_ports
            ports = serial.tools.list_ports.comports()
            available_ports = []
            
            for port in ports:
                # Filter for likely Arduino ports
                port_name = port.device
                port_desc = getattr(port, 'description', '').lower()
                
                if any(keyword in port_desc for keyword in ['arduino', 'mega', 'usb', 'serial']):
                    available_ports.append(port_name)
                elif port_name.startswith(('COM', '/dev/ttyUSB', '/dev/ttyACM')):
                    available_ports.append(port_name)
            
            return available_ports
        except Exception as e:
            print(f"Error getting ports: {e}")
            return []

# Global Arduino controller instance
arduino_controller = ArduinoController()

def initialize_arduino(port: str = None):
    """Initialize Arduino connection with auto-detection if port not specified"""
    global arduino_controller
    
    print("Initializing Arduino connection...")
    
    if port:
        arduino_controller.port = port
        print(f"Using specified port: {port}")
    else:
        # Try to auto-detect Arduino
        available_ports = arduino_controller.get_available_ports()
        print(f"Available ports: {available_ports}")
        
        if not available_ports:
            print("No suitable ports found")
            return False
        
        # Common Arduino ports (prioritized)
        common_ports = ['COM3', 'COM4', 'COM5', '/dev/ttyUSB0', '/dev/ttyACM0', '/dev/ttyUSB1', '/dev/ttyACM1']
        
        # Try common ports first if they're available
        for test_port in common_ports:
            if test_port in available_ports:
                arduino_controller.port = test_port
                print(f"Auto-selected port: {test_port}")
                break
        else:
            # Use first available port
            arduino_controller.port = available_ports[0]
            print(f"Using first available port: {available_ports[0]}")
    
    success = arduino_controller.connect()
    if success:
        print("Arduino initialization successful")
    else:
        print("Arduino initialization failed")
    
    return success

def send_traffic_data(road_data: List[Dict]):
    """Send traffic data to Arduino"""
    global arduino_controller
    
    if not arduino_controller.connected:
        print("Arduino not connected, cannot send traffic data")
        return False
    
    try:
        for road in road_data:
            road_id = road.get('id', 1)
            vehicle_count = len(road.get('detections', []))
            has_emergency = road.get('hasEmergencyVehicle', False)
            
            success = arduino_controller.update_road_data(road_id, vehicle_count, has_emergency)
            if success:
                print(f"Sent traffic data for road {road_id}: {vehicle_count} vehicles, emergency: {has_emergency}")
        
        return True
    except Exception as e:
        print(f"Error sending traffic data: {e}")
        return False
