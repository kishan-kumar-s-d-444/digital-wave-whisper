# =============================
# Updated Arduino Controller
# =============================

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
        try:
            print(f"🔌 Connecting to Arduino on {self.port}...")
            self.serial_connection = serial.Serial(self.port, self.baud_rate, timeout=5, write_timeout=5)
            time.sleep(7)  # Increased delay for Arduino reset
            
            if self.serial_connection.in_waiting:
                startup_data = self.serial_connection.read_all()
                print(f"📥 Startup data: {startup_data.decode(errors='ignore')}")

            self.connected = True
            print("✅ Arduino connected")
            
            self.comm_thread = threading.Thread(target=self._communication_loop, daemon=True)
            self.comm_thread.start()
            
            time.sleep(2)
            self.command_queue.put("STATUS\n")
            return True

        except Exception as e:
            print(f"❌ Connection failed: {e}")
            self.connected = False
            if self.serial_connection:
                try: self.serial_connection.close()
                except: pass
            return False

    def disconnect(self):
        print("🔌 Disconnecting Arduino...")
        self.connected = False
        if self.serial_connection:
            try:
                self.command_queue.put("STOP\n")
                time.sleep(3)
                self.serial_connection.close()
            except Exception as e:
                print(f"⚠️ Disconnect error: {e}")
        print("✅ Arduino disconnected")

    def start_traffic_system(self):
        if self.connected:
            self.command_queue.put("START\n")
            return True
        return False

    def stop_traffic_system(self):
        if self.connected:
            self.command_queue.put("STOP\n")
            return True
        return False

    def update_road_data(self, road_id: int, vehicle_count: int, has_emergency: bool):
        if self.connected:
            cmd = f"UPDATE:{road_id}:{vehicle_count}:{str(has_emergency).lower()}\n"
            self.command_queue.put(cmd)
            return True
        return False

    def get_available_ports(self):
        import serial.tools.list_ports
        ports = serial.tools.list_ports.comports()
        result = []
        for p in ports:
            desc = (p.description or '').lower()
            if any(k in desc for k in ['arduino', 'ch340', 'mega', 'uno', 'ftdi']):
                result.append(p.device)
            elif p.device.startswith(('COM', '/dev/ttyUSB', '/dev/ttyACM')):
                result.append(p.device)
        return result

    def _communication_loop(self):
        print("🔄 Communication loop started")
        while self.connected and self.serial_connection:
            try:
                if not self.command_queue.empty():
                    cmd = self.command_queue.get()
                    self.serial_connection.write(cmd.encode())
                    print(f"📤 Sent: {cmd.strip()}")
                    time.sleep(0.5)
                if self.serial_connection.in_waiting:
                    resp = self.serial_connection.readline().decode(errors='ignore').strip()
                    if resp:
                        print(f"📥 Received: {resp}")
                time.sleep(0.2)
            except Exception as e:
                print(f"❌ Serial error: {e}")
                break
        print("🔄 Communication loop ended")

arduino_controller = ArduinoController()

def initialize_arduino(port: Optional[str] = None):
    if port: arduino_controller.port = port
    else:
        ports = arduino_controller.get_available_ports()
        arduino_controller.port = ports[0] if ports else 'COM3'
    return arduino_controller.connect()

def send_traffic_data(data: List[Dict]):
    for road in data:
        arduino_controller.update_road_data(road.get('id',1), len(road.get('detections',[])), road.get('hasEmergencyVehicle',False))
