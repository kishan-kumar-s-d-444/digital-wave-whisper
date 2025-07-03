
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
        """Connect to Arduino with proper initialization delays"""
        try:
            print(f"🔌 Attempting Arduino connection on {self.port}...")
            self.serial_connection = serial.Serial(
                self.port, 
                self.baud_rate, 
                timeout=3,
                write_timeout=3
            )
            
            # Critical: Give Arduino time to reset and initialize
            print("⏳ Waiting for Arduino to reset and initialize...")
            time.sleep(5)  # Increased Arduino reset delay
            
            # Clear any startup data from Arduino
            if self.serial_connection.in_waiting:
                startup_data = self.serial_connection.read_all()
                print(f"📥 Arduino startup data: {startup_data.decode('utf-8', errors='ignore')}")
            
            self.connected = True
            print(f"✅ Arduino connected successfully on {self.port}")
            
            # Start communication thread
            self.comm_thread = threading.Thread(target=self._communication_loop, daemon=True)
            self.comm_thread.start()
            
            # Send initial status request to verify communication
            time.sleep(1)
            self.command_queue.put("STATUS\n")
            
            return True
            
        except serial.SerialException as e:
            print(f"❌ Serial connection failed: {e}")
            self.connected = False
            if self.serial_connection:
                try:
                    self.serial_connection.close()
                except:
                    pass
                self.serial_connection = None
            return False
        except Exception as e:
            print(f"❌ Unexpected connection error: {e}")
            self.connected = False
            return False
    
    def disconnect(self):
        """Safely disconnect from Arduino"""
        print("🔌 Disconnecting from Arduino...")
        self.connected = False
        
        if self.serial_connection:
            try:
                # Send stop command before disconnecting
                print("🛑 Sending STOP command...")
                self.command_queue.put("STOP\n")
                time.sleep(2)  # Give time for command to be processed
                
                self.serial_connection.close()
                print("✅ Arduino connection closed")
            except Exception as e:
                print(f"⚠️ Error during disconnect: {e}")
            finally:
                self.serial_connection = None
        
        if self.comm_thread and self.comm_thread.is_alive():
            self.comm_thread.join(timeout=3)
            
        print("✅ Arduino disconnected successfully")
    
    def start_traffic_system(self):
        """Start the traffic control system"""
        if self.connected:
            print("🚦 Starting traffic control system...")
            self.command_queue.put("START\n")
            return True
        else:
            print("❌ Cannot start: Arduino not connected")
            return False
    
    def stop_traffic_system(self):
        """Stop the traffic control system"""
        if self.connected:
            print("🛑 Stopping traffic control system...")
            self.command_queue.put("STOP\n")
            return True
        else:
            print("❌ Cannot stop: Arduino not connected")
            return False
    
    def update_road_data(self, road_id: int, vehicle_count: int, has_emergency: bool):
        """Update vehicle count and emergency status for a road"""
        if self.connected:
            command = f"UPDATE:{road_id}:{vehicle_count}:{str(has_emergency).lower()}\n"
            self.command_queue.put(command)
            print(f"🚗 Updated Road {road_id}: {vehicle_count} vehicles, Emergency: {has_emergency}")
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
        print("🔄 Arduino communication loop started")
        consecutive_errors = 0
        max_consecutive_errors = 5
        
        while self.connected and self.serial_connection:
            try:
                # Send queued commands
                if not self.command_queue.empty():
                    command = self.command_queue.get()
                    self.serial_connection.write(command.encode())
                    print(f"📤 Sent to Arduino: {command.strip()}")
                    time.sleep(0.3)  # Allow Arduino time to process
                
                # Read Arduino responses
                if self.serial_connection.in_waiting:
                    response = self.serial_connection.readline().decode('utf-8').strip()
                    if response:
                        print(f"📥 Arduino response: {response}")
                        self.response_queue.put(response)
                        consecutive_errors = 0  # Reset error counter on successful communication
                
                time.sleep(0.1)  # Small delay to prevent CPU overload
                
            except serial.SerialException as e:
                consecutive_errors += 1
                print(f"🔄 Serial communication error #{consecutive_errors}: {e}")
                
                if consecutive_errors >= max_consecutive_errors:
                    print(f"❌ Too many consecutive errors ({consecutive_errors}), stopping communication")
                    break
                    
                # Try to recover
                time.sleep(1)
                
            except Exception as e:
                consecutive_errors += 1
                print(f"🔄 Unexpected communication error #{consecutive_errors}: {e}")
                
                if consecutive_errors >= max_consecutive_errors:
                    print(f"❌ Too many consecutive errors, stopping communication")
                    break
                    
                time.sleep(1)
        
        print("🔄 Arduino communication loop ended")
    
    def get_available_ports(self):
        """Get list of available serial ports for Arduino"""
        try:
            import serial.tools.list_ports
            ports = serial.tools.list_ports.comports()
            available_ports = []
            
            print("🔍 Scanning for available serial ports...")
            
            for port in ports:
                port_name = port.device
                port_desc = getattr(port, 'description', '').lower()
                port_hwid = getattr(port, 'hwid', '').lower()
                
                print(f"📟 Found port: {port_name} - {port.description}")
                
                # Look for Arduino-specific identifiers
                arduino_keywords = ['arduino', 'mega', 'uno', 'ch340', 'ch341', 'ftdi', 'usb serial']
                
                if any(keyword in port_desc for keyword in arduino_keywords) or \
                   any(keyword in port_hwid for keyword in arduino_keywords):
                    available_ports.append(port_name)
                    print(f"✅ Arduino-compatible port detected: {port_name}")
                elif port_name.startswith(('COM', '/dev/ttyUSB', '/dev/ttyACM')):
                    available_ports.append(port_name)
                    print(f"📟 Generic serial port added: {port_name}")
            
            print(f"📋 Total available ports: {available_ports}")
            return available_ports
            
        except Exception as e:
            print(f"❌ Error scanning ports: {e}")
            return []

# Global Arduino controller instance
arduino_controller = ArduinoController()

def initialize_arduino(port: str = None):
    """Initialize Arduino connection with enhanced port detection"""
    global arduino_controller
    
    print("\n" + "="*50)
    print("🔌 INITIALIZING ARDUINO CONNECTION")
    print("="*50)
    
    if port:
        arduino_controller.port = port
        print(f"🎯 Using specified port: {port}")
    else:
        # Enhanced auto-detection
        available_ports = arduino_controller.get_available_ports()
        
        if not available_ports:
            print("❌ No suitable Arduino ports found!")
            print("💡 Make sure Arduino is connected via USB")
            return False
        
        # Prioritize common Arduino ports
        priority_ports = ['COM3', 'COM4', 'COM5', '/dev/ttyUSB0', '/dev/ttyACM0']
        
        selected_port = None
        for priority_port in priority_ports:
            if priority_port in available_ports:
                selected_port = priority_port
                break
        
        if not selected_port:
            selected_port = available_ports[0]
        
        arduino_controller.port = selected_port
        print(f"🎯 Auto-selected port: {selected_port}")
    
    # Attempt connection
    success = arduino_controller.connect()
    
    if success:
        print("✅ ARDUINO INITIALIZATION SUCCESSFUL!")
        print("🚦 Ready for traffic control commands")
    else:
        print("❌ ARDUINO INITIALIZATION FAILED!")
        print("💡 Check Arduino connection and try different port")
    
    print("="*50 + "\n")
    return success

def send_traffic_data(road_data: List[Dict]):
    """Send traffic data to Arduino with enhanced logging"""
    global arduino_controller
    
    if not arduino_controller.connected:
        print("❌ Cannot send traffic data: Arduino not connected")
        return False
    
    try:
        print("🚗 Sending traffic data to Arduino...")
        
        for road in road_data:
            road_id = road.get('id', 1)
            vehicle_count = len(road.get('detections', []))
            has_emergency = road.get('hasEmergencyVehicle', False)
            
            success = arduino_controller.update_road_data(road_id, vehicle_count, has_emergency)
            if not success:
                print(f"⚠️ Failed to send data for road {road_id}")
        
        print("✅ Traffic data sent successfully")
        return True
        
    except Exception as e:
        print(f"❌ Error sending traffic data: {e}")
        return False
