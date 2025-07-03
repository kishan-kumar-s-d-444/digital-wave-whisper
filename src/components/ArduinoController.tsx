import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Microchip, Wifi, WifiOff, Play, Square, Settings, Zap, AlertTriangle } from "lucide-react";

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
  const [isLoading, setIsLoading] = useState(true);
  const [backendReady, setBackendReady] = useState(false);

  useEffect(() => {
    // Wait longer before first check to allow backend to start
    const initialDelay = setTimeout(() => {
      checkBackendHealth();
    }, 3000);

    return () => clearTimeout(initialDelay);
  }, []);

  useEffect(() => {
    if (backendReady) {
      checkArduinoStatus();
      const interval = setInterval(checkArduinoStatus, 8000); // Increased interval
      return () => clearInterval(interval);
    }
  }, [backendReady]);

  const checkBackendHealth = async () => {
    try {
      setIsLoading(true);
      console.log("Checking backend health...");
      
      const response = await fetch(`${API_BASE_URL}/health`, {
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) throw new Error('Backend not ready');
      
      const data = await response.json();
      console.log("Backend health check passed:", data);
      setBackendReady(true);
      setError("");
    } catch (err) {
      console.error("Backend not ready:", err);
      setBackendReady(false);
      setError("Backend service is starting up... Please wait");
      
      // Retry after delay
      setTimeout(checkBackendHealth, 5000);
    } finally {
      setIsLoading(false);
    }
  };

  const checkArduinoStatus = async () => {
    if (!backendReady) return;
    
    try {
      console.log("Checking Arduino status...");
      const response = await fetch(`${API_BASE_URL}/arduino/status`, {
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) throw new Error('Arduino status check failed');
      
      const data = await response.json();
      console.log("Arduino status:", data);
      
      setIsConnected(data.connected);
      setAvailablePorts((data.available_ports || []).filter(port => port && port.trim() !== ''));
      onConnectionChange(data.connected);
      
      if (error && !error.includes("Backend service")) {
        setError("");
      }
    } catch (err) {
      console.error("Failed to check Arduino status:", err);
      setIsConnected(false);
      onConnectionChange(false);
      if (backendReady) {
        setError("Failed to communicate with Arduino controller");
      }
    }
  };

  const connectArduino = async () => {
    if (!backendReady) {
      setError("Backend service is not ready yet. Please wait...");
      return;
    }

    setIsConnecting(true);
    setError("");
    
    try {
      console.log("Attempting to connect Arduino on port:", selectedPort);
      
      const response = await fetch(`${API_BASE_URL}/arduino/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          port: selectedPort === "auto" ? null : selectedPort
        }),
        signal: AbortSignal.timeout(10000) // Increased timeout for connection
      });

      const data = await response.json();
      console.log("Arduino connection response:", data);
      
      if (!response.ok) throw new Error(data.message || "Failed to connect to Arduino");
      
      // Wait a bit for Arduino to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setIsConnected(true);
      onConnectionChange(true);
      setError("");
      
      // Refresh status after connection
      setTimeout(checkArduinoStatus, 1000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to connect to Arduino";
      setError(errorMsg);
      console.error("Arduino connection error:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectArduino = async () => {
    try {
      console.log("Disconnecting Arduino...");
      const response = await fetch(`${API_BASE_URL}/arduino/disconnect`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message || "Failed to disconnect from Arduino");
      
      setIsConnected(false);
      setSystemActive(false);
      onConnectionChange(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect from Arduino");
      console.error("Arduino disconnection error:", err);
    }
  };

  const startTrafficSystem = async () => {
    try {
      console.log("Starting traffic system...");
      const response = await fetch(`${API_BASE_URL}/arduino/start`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message || "Failed to start traffic system");
      
      setSystemActive(true);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start traffic system");
      console.error("Traffic system start error:", err);
    }
  };

  const stopTrafficSystem = async () => {
    try {
      console.log("Stopping traffic system...");
      const response = await fetch(`${API_BASE_URL}/arduino/stop`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message || "Failed to stop traffic system");
      
      setSystemActive(false);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop traffic system");
      console.error("Traffic system stop error:", err);
    }
  };

  const handleRetry = () => {
    setError("");
    if (!backendReady) {
      checkBackendHealth();
    } else {
      checkArduinoStatus();
    }
  };

  return (
    <Card className="bg-black/40 backdrop-blur-md border-white/20">
      <CardHeader>
        <CardTitle className="text-white flex items-center">
          <Microchip className="h-5 w-5 mr-2" />
          Arduino Traffic Controller
          <Badge 
            variant="secondary" 
            className={`ml-2 ${isConnected ? 'bg-green-600' : backendReady ? 'bg-yellow-600' : 'bg-red-600'} text-white`}
          >
            {isConnected ? (
              <>
                <Wifi className="h-3 w-3 mr-1" />
                Connected
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3 mr-1" />
                {backendReady ? 'Ready' : 'Starting...'}
              </>
            )}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert className="bg-red-900/50 border-red-500">
            <div className="flex items-center justify-between">
              <AlertDescription className="text-white flex items-center">
                <AlertTriangle className="h-4 w-4 mr-2" />
                {error}
              </AlertDescription>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:bg-white/10"
                onClick={handleRetry}
              >
                Retry
              </Button>
            </div>
          </Alert>
        )}

        {isLoading || !backendReady ? (
          <div className="flex flex-col items-center justify-center py-4 space-y-2">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <p className="text-white text-sm">
              {!backendReady ? "Waiting for backend service..." : "Loading..."}
            </p>
          </div>
        ) : !isConnected ? (
          <div className="space-y-3">
            <div>
              <label className="text-white text-sm mb-2 block">Serial Port:</label>
              <Select 
                value={selectedPort} 
                onValueChange={setSelectedPort}
                disabled={isConnecting}
              >
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue placeholder="Select Arduino port" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 text-white border-white/20">
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  {availablePorts.map((port) => (
                    <SelectItem 
                      key={port} 
                      value={port}
                      className="hover:bg-gray-700"
                    >
                      {port}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={connectArduino} 
              disabled={isConnecting || !backendReady}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isConnecting ? (
                <>
                  <span className="animate-pulse">Connecting...</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Connect Arduino
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-white text-sm">Hardware Status:</span>
              <Badge className="bg-green-600 text-white">
                <Zap className="h-3 w-3 mr-1" />
                Ready
              </Badge>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-white text-sm">Traffic System:</span>
              <Badge className={systemActive ? "bg-green-600 text-white" : "bg-gray-600 text-white"}>
                {systemActive ? "Active" : "Stopped"}
              </Badge>
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
        )}

        <div className="text-xs text-purple-200 space-y-1">
          <p>• Connect Arduino Mega via USB</p>
          <p>• Upload traffic_controller.ino to Arduino</p>
          <p>• Start Python backend server first</p>
          <p>• Traffic lights controlled automatically</p>
          <p>• Emergency vehicles get priority override</p>
        </div>
      </CardContent>
    </Card>
  );
};
