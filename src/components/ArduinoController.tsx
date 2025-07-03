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

  useEffect(() => {
    checkArduinoStatus();
    const interval = setInterval(checkArduinoStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkArduinoStatus = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${API_BASE_URL}/arduino/status`, {
        signal: AbortSignal.timeout(3000)
      });
      
      if (!response.ok) throw new Error('API response not OK');
      
      const data = await response.json();
      setIsConnected(data.connected);
      setAvailablePorts((data.available_ports || []).filter(port => port && port.trim() !== ''));
      onConnectionChange(data.connected);
      setError("");
    } catch (err) {
      console.error("Failed to check Arduino status:", err);
      setIsConnected(false);
      onConnectionChange(false);
      setError("Backend service unavailable");
    } finally {
      setIsLoading(false);
    }
  };

  const connectArduino = async () => {
    setIsConnecting(true);
    setError("");
    
    try {
      const response = await fetch(`${API_BASE_URL}/arduino/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          port: selectedPort === "auto" ? null : selectedPort
        }),
        signal: AbortSignal.timeout(5000)
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.message || "Failed to connect to Arduino");
      
      setIsConnected(true);
      onConnectionChange(true);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to Arduino");
      console.error("Arduino connection error:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectArduino = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/arduino/disconnect`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000)
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
      const response = await fetch(`${API_BASE_URL}/arduino/start`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000)
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
      const response = await fetch(`${API_BASE_URL}/arduino/stop`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000)
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
    checkArduinoStatus();
  };

  return (
    <Card className="bg-black/40 backdrop-blur-md border-white/20">
      <CardHeader>
        <CardTitle className="text-white flex items-center">
          <Microchip className="h-5 w-5 mr-2" />
          Arduino Traffic Controller
          <Badge 
            variant="secondary" 
            className={`ml-2 ${isConnected ? 'bg-green-600' : 'bg-red-600'} text-white`}
          >
            {isConnected ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
            {isConnected ? 'Connected' : 'Disconnected'}
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

        {isLoading ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
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
              disabled={isConnecting}
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
          <p>• Traffic lights will be controlled automatically</p>
          <p>• Emergency vehicles get priority override</p>
        </div>
      </CardContent>
    </Card>
  );
};