
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Microchip, Wifi, WifiOff, Play, Square, Settings, Zap, AlertTriangle, Server, Terminal } from "lucide-react";

interface ArduinoControllerProps {
  onConnectionChange: (connected: boolean) => void;
}

const API_BASE_URL = "http://localhost:8000";

export const ArduinoController = ({ onConnectionChange }: ArduinoControllerProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedPort, setSelectedPort] = useState("auto");
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const [systemActive, setSystemActive] = useState(false);
  const [error, setError] = useState("");
  const [backendReady, setBackendReady] = useState(false);
  const [backendChecking, setBackendChecking] = useState(true);

  useEffect(() => {
    // Check backend immediately and then every 3 seconds
    checkBackendHealth();
    const interval = setInterval(checkBackendHealth, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Only check Arduino status when backend is ready
    if (backendReady) {
      checkArduinoStatus();
      const interval = setInterval(checkArduinoStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [backendReady]);

  const checkBackendHealth = async () => {
    try {
      setBackendChecking(true);
      console.log("Checking if Python backend is running...");
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(`${API_BASE_URL}/health`, {
        signal: controller.signal,
        mode: 'cors'
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Backend returned ${response.status}`);
      }
      
      const data = await response.json();
      console.log("✅ Python backend is running successfully!");
      setBackendReady(true);
      setError("");
      
    } catch (err) {
      console.error("❌ Python backend not accessible:", err);
      setBackendReady(false);
      
      if (err instanceof Error && err.name === 'AbortError') {
        setError("🔄 Checking for Python server... Make sure to run the backend first!");
      } else {
        setError("⚠️ Python backend server is not running. Please start it first!");
      }
    } finally {
      setBackendChecking(false);
    }
  };

  const checkArduinoStatus = async () => {
    if (!backendReady) return;
    
    try {
      console.log("Checking Arduino connection status...");
      const response = await fetch(`${API_BASE_URL}/arduino/status`, {
        signal: AbortSignal.timeout(3000)
      });
      
      if (!response.ok) throw new Error('Arduino status check failed');
      
      const data = await response.json();
      console.log("Arduino status received:", data);
      
      setIsConnected(data.connected);
      setAvailablePorts(data.available_ports || []);
      onConnectionChange(data.connected);
      
    } catch (err) {
      console.error("Failed to get Arduino status:", err);
      setIsConnected(false);
      onConnectionChange(false);
    }
  };

  const connectArduino = async () => {
    if (!backendReady) {
      setError("❌ Cannot connect Arduino: Python backend is not running!");
      return;
    }

    setIsConnecting(true);
    setError("");
    
    try {
      console.log("🔌 Connecting to Arduino on port:", selectedPort);
      
      const response = await fetch(`${API_BASE_URL}/arduino/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          port: selectedPort === "auto" ? null : selectedPort
        }),
        signal: AbortSignal.timeout(15000)
      });

      const data = await response.json();
      console.log("Arduino connection response:", data);
      
      if (!response.ok) {
        throw new Error(data.message || "Failed to connect to Arduino");
      }
      
      // Wait for Arduino to fully initialize
      console.log("⏳ Waiting for Arduino to initialize...");
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      setIsConnected(true);
      onConnectionChange(true);
      setError("");
      console.log("✅ Arduino connected successfully!");
      
      // Refresh status
      setTimeout(checkArduinoStatus, 1000);
      
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to connect to Arduino";
      setError(`❌ ${errorMsg}`);
      console.error("Arduino connection failed:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectArduino = async () => {
    try {
      console.log("🔌 Disconnecting Arduino...");
      const response = await fetch(`${API_BASE_URL}/arduino/disconnect`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message || "Failed to disconnect");
      
      setIsConnected(false);
      setSystemActive(false);
      onConnectionChange(false);
      setError("");
      console.log("✅ Arduino disconnected");
      
    } catch (err) {
      setError(`❌ Disconnect failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const startTrafficSystem = async () => {
    try {
      console.log("🚦 Starting traffic control system...");
      const response = await fetch(`${API_BASE_URL}/arduino/start`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message || "Failed to start traffic system");
      
      setSystemActive(true);
      setError("");
      console.log("✅ Traffic system started!");
      
    } catch (err) {
      setError(`❌ Start failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const stopTrafficSystem = async () => {
    try {
      console.log("🛑 Stopping traffic control system...");
      const response = await fetch(`${API_BASE_URL}/arduino/stop`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message || "Failed to stop traffic system");
      
      setSystemActive(false);
      setError("");
      console.log("✅ Traffic system stopped!");
      
    } catch (err) {
      setError(`❌ Stop failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const getBackendStatusBadge = () => {
    if (backendChecking) {
      return (
        <Badge variant="secondary" className="bg-yellow-600 text-white animate-pulse">
          <Terminal className="h-3 w-3 mr-1" />
          Checking...
        </Badge>
      );
    }
    
    if (!backendReady) {
      return (
        <Badge variant="secondary" className="bg-red-600 text-white">
          <Server className="h-3 w-3 mr-1" />
          Backend Down
        </Badge>
      );
    }
    
    if (isConnected) {
      return (
        <Badge variant="secondary" className="bg-green-600 text-white">
          <Wifi className="h-3 w-3 mr-1" />
          Arduino Connected
        </Badge>
      );
    }
    
    return (
      <Badge variant="secondary" className="bg-blue-600 text-white">
        <WifiOff className="h-3 w-3 mr-1" />
        Ready to Connect
      </Badge>
    );
  };

  return (
    <Card className="bg-black/40 backdrop-blur-md border-white/20">
      <CardHeader>
        <CardTitle className="text-white flex items-center">
          <Microchip className="h-5 w-5 mr-2" />
          Arduino Traffic Controller
          {getBackendStatusBadge()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Backend Status Alert */}
        {!backendReady && (
          <Alert className="bg-red-900/50 border-red-500">
            <AlertDescription className="text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  <div>
                    <div className="font-semibold">Python Backend Not Running</div>
                    <div className="text-sm mt-1">
                      1. Open terminal in backend folder<br/>
                      2. Run: <code className="bg-black/30 px-1 rounded">python run.py</code><br/>
                      3. Wait for "Backend ready for connections" message
                    </div>
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-white hover:bg-white/10"
                  onClick={checkBackendHealth}
                  disabled={backendChecking}
                >
                  {backendChecking ? "Checking..." : "Retry"}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Connection Error */}
        {error && backendReady && (
          <Alert className="bg-red-900/50 border-red-500">
            <AlertDescription className="text-white flex items-center justify-between">
              <div className="flex items-center">
                <AlertTriangle className="h-4 w-4 mr-2" />
                {error}
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:bg-white/10"
                onClick={checkArduinoStatus}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {backendReady && !isConnected ? (
          <div className="space-y-3">
            <div>
              <label className="text-white text-sm mb-2 block">Arduino Serial Port:</label>
              <Select 
                value={selectedPort} 
                onValueChange={setSelectedPort}
                disabled={isConnecting}
              >
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Select Arduino port" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 text-white border-white/20">
                  <SelectItem value="auto">🔍 Auto-detect Arduino</SelectItem>
                  {availablePorts.map((port) => (
                    <SelectItem 
                      key={port} 
                      value={port}
                      className="hover:bg-gray-700"
                    >
                      📟 {port}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={connectArduino} 
              disabled={isConnecting}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isConnecting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Connecting to Arduino...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Connect Arduino
                </>
              )}
            </Button>
          </div>
        ) : backendReady && isConnected ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-white">Hardware:</span>
                <Badge className="bg-green-600 text-white">
                  <Zap className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-white">Traffic System:</span>
                <Badge className={systemActive ? "bg-green-600 text-white" : "bg-gray-600 text-white"}>
                  {systemActive ? "🟢 Active" : "🔴 Stopped"}
                </Badge>
              </div>
            </div>

            <div className="flex gap-2">
              {!systemActive ? (
                <Button 
                  onClick={startTrafficSystem}
                  className="flex-1 bg-green-600 hover:bg-green-700"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Start Traffic Control
                </Button>
              ) : (
                <Button 
                  onClick={stopTrafficSystem}
                  variant="destructive"
                  className="flex-1"
                >
                  <Square className="h-4 w-4 mr-2" />
                  Stop Traffic Control
                </Button>
              )}
              <Button 
                onClick={disconnectArduino}
                variant="outline"
                className="bg-white/10 border-white/20 text-white hover:bg-white/20"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}

        {/* Instructions */}
        <div className="text-xs text-purple-200 space-y-1 border-t border-white/10 pt-3">
          <p><strong>Setup Steps:</strong></p>
          <p>1. 🔌 Connect Arduino Mega to computer via USB</p>
          <p>2. 📤 Upload traffic_controller.ino to Arduino IDE</p>
          <p>3. 🐍 Start Python backend: <code>python run.py</code></p>
          <p>4. 🌐 Connect Arduino through this interface</p>
          <p>5. 🚦 Start traffic system for automatic control</p>
        </div>
      </CardContent>
    </Card>
  );
};
