
import { useRef, useEffect, useState, useCallback } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Camera, Settings, Wifi, WifiOff, Play, Square, RefreshCw, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWebSocketDetection } from "@/hooks/useWebSocketDetection";

interface Detection {
  class: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
}

interface WebcamCaptureProps {
  globalDetectionActive: boolean;
  onDetectionUpdate: (predictions: Detection[]) => void;
  onStatusChange: (isActive: boolean) => void;
  cameraId?: number;
  deviceId?: string;
}

export const WebcamCapture = ({ 
  globalDetectionActive, 
  onDetectionUpdate, 
  onStatusChange, 
  cameraId = 1,
  deviceId: propDeviceId = ""
}: WebcamCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [detectionInterval, setDetectionInterval] = useState<NodeJS.Timeout | null>(null);

  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [overlapThreshold, setOverlapThreshold] = useState(0.5);
  const [opacityThreshold, setOpacityThreshold] = useState(0.75);
  const [labelDisplayMode, setLabelDisplayMode] = useState("Draw Confidence");

  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>(propDeviceId);

  // WebSocket detection hook
  const {
    isConnected: wsConnected,
    connectionError: wsError,
    processingTime: wsProcessingTime,
    recentDetections: wsDetections,
    sendFrame,
    forceReconnect: wsForceReconnect
  } = useWebSocketDetection({
    cameraId,
    enabled: globalDetectionActive && isStreaming,
    onDetectionUpdate,
    confidenceThreshold,
    overlapThreshold
  });

  // Get available cameras
  useEffect(() => {
    const getCameras = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setAvailableCameras(videoDevices);
        
        if (videoDevices.length > 0 && !selectedCameraId) {
          setSelectedCameraId(videoDevices[0].deviceId);
        }
        
        stream.getTracks().forEach(track => track.stop());
      } catch (err) {
        console.error("Error getting cameras:", err);
        setError("Failed to get cameras. Please check permissions.");
      }
    };

    getCameras();
  }, [selectedCameraId]);

  // WebSocket detection function
  const performWebSocketDetection = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !wsConnected) {
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/jpeg', 0.8);
    sendFrame(imageData, canvas.width, canvas.height);
  }, [wsConnected, sendFrame]);

  const startWebcam = async () => {
    if (!selectedCameraId) {
      setError("Please select a camera first");
      return;
    }

    try {
      const constraints = {
        video: {
          deviceId: { exact: selectedCameraId },
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      };

      const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.play();
      }

      setStream(mediaStream);
      setIsStreaming(true);
      onStatusChange(true);
      setError("");

      // Start detection interval
      const interval = setInterval(performWebSocketDetection, 1000);
      setDetectionInterval(interval);
    } catch (err) {
      setError("Failed to access webcam. Please check permissions.");
      console.error("Webcam error:", err);
    }
  };

  const stopWebcam = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }

    if (detectionInterval) {
      clearInterval(detectionInterval);
      setDetectionInterval(null);
    }

    setIsStreaming(false);
    onStatusChange(false);
  };

  // Draw detections on canvas
  const drawDetections = useCallback((
    ctx: CanvasRenderingContext2D,
    predictions: Detection[],
    width: number,
    height: number
  ) => {
    ctx.globalAlpha = opacityThreshold;

    predictions.forEach((det) => {
      const x = det.x - det.width / 2;
      const y = det.y - det.height / 2;

      let color = '#00ff00';
      if (det.class.toLowerCase().includes('emergency')) color = '#ff0000';
      else if (det.class.toLowerCase().includes('truck')) color = '#ffff00';
      else if (det.class.toLowerCase().includes('car')) color = '#00ffff';

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, det.width, det.height);

      if (labelDisplayMode !== "Hidden") {
        let label = det.class;
        if (labelDisplayMode === "Draw Confidence") {
          label = `${det.class} ${Math.round(det.confidence * 100)}%`;
        }
        
        ctx.font = '16px Arial';
        const textWidth = ctx.measureText(label).width;

        ctx.fillStyle = `${color}CC`;
        ctx.fillRect(x, y - 25, textWidth + 10, 25);
        ctx.fillStyle = '#000000';
        ctx.fillText(label, x + 5, y - 5);
      }
    });

    ctx.globalAlpha = 1.0;
  }, [labelDisplayMode, opacityThreshold]);

  // Render loop
  useEffect(() => {
    let animationFrameId: number;

    const renderLoop = () => {
      const ctx = canvasRef.current?.getContext('2d');
      const video = videoRef.current;

      if (ctx && video && video.videoWidth > 0 && video.videoHeight > 0) {
        const canvas = canvasRef.current!;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        drawDetections(ctx, wsDetections, canvas.width, canvas.height);
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [wsDetections, drawDetections]);

  // Handle global detection changes
  useEffect(() => {
    if (globalDetectionActive && !isStreaming) {
      startWebcam();
    } else if (!globalDetectionActive && isStreaming) {
      stopWebcam();
    }
  }, [globalDetectionActive]);

  return (
    <div className="space-y-4">
      {/* WebSocket Status */}
      <Alert className={`${wsConnected ? 'bg-green-900/50 border-green-500' : 'bg-red-900/50 border-red-500'}`}>
        {wsConnected ? <Zap className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        <AlertDescription className="text-white flex items-center justify-between">
          <span>
            WebSocket: {wsConnected ? 'Connected' : 'Disconnected'}
            {wsError && ` - ${wsError}`}
          </span>
          {!wsConnected && (
            <Button 
              onClick={wsForceReconnect}
              size="sm" 
              variant="outline"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Reconnect
            </Button>
          )}
        </AlertDescription>
      </Alert>

      {error && (
        <Alert className="bg-red-900/50 border-red-500">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-white">{error}</AlertDescription>
        </Alert>
      )}

      {/* Camera Selection */}
      <Card className="bg-black/40 backdrop-blur-md border-white/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center">
            <Camera className="h-5 w-5 mr-2" />
            Camera Selection
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
            <SelectTrigger className="bg-white/10 border-white/20 text-white">
              <SelectValue placeholder="Choose a camera..." />
            </SelectTrigger>
            <SelectContent>
              {availableCameras.map((camera, index) => (
                <SelectItem key={camera.deviceId} value={camera.deviceId}>
                  {camera.label || `Camera ${index + 1}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Detection Settings */}
      <Card className="bg-black/40 backdrop-blur-md border-white/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center">
            <Settings className="h-5 w-5 mr-2" />
            Detection Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-white text-sm mb-2 block">
              Confidence: {Math.round(confidenceThreshold * 100)}%
            </label>
            <Slider 
              value={[confidenceThreshold]} 
              onValueChange={(value) => setConfidenceThreshold(value[0])} 
              min={0} 
              max={1} 
              step={0.01} 
            />
          </div>
          <div>
            <label className="text-white text-sm mb-2 block">
              Overlap: {Math.round(overlapThreshold * 100)}%
            </label>
            <Slider 
              value={[overlapThreshold]} 
              onValueChange={(value) => setOverlapThreshold(value[0])} 
              min={0} 
              max={1} 
              step={0.01} 
            />
          </div>
          <div>
            <label className="text-white text-sm mb-2 block">
              Opacity: {Math.round(opacityThreshold * 100)}%
            </label>
            <Slider 
              value={[opacityThreshold]} 
              onValueChange={(value) => setOpacityThreshold(value[0])} 
              min={0} 
              max={1} 
              step={0.01} 
            />
          </div>
          <div>
            <label className="text-white text-sm mb-2 block">Labels:</label>
            <Select value={labelDisplayMode} onValueChange={setLabelDisplayMode}>
              <SelectTrigger className="bg-white/10 border-white/20 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Draw Confidence">With Confidence</SelectItem>
                <SelectItem value="Class Only">Class Only</SelectItem>
                <SelectItem value="Hidden">Hidden</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {wsProcessingTime > 0 && (
            <div className="text-green-200 text-sm">
              Processing: {(wsProcessingTime * 1000).toFixed(0)}ms
            </div>
          )}
        </CardContent>
      </Card>

      {/* Video Display */}
      <div className="relative bg-black rounded-lg overflow-hidden">
        <video ref={videoRef} className="w-full h-auto max-h-[400px] object-cover" muted playsInline />
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full object-cover" />
        {!isStreaming && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-center text-white">
              <Camera className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Camera Off</p>
            </div>
          </div>
        )}
        {!wsConnected && isStreaming && (
          <div className="absolute top-2 left-2 bg-red-600 text-white px-2 py-1 rounded text-sm flex items-center gap-1">
            <WifiOff className="h-3 w-3" />
            WebSocket Disconnected
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        {!isStreaming ? (
          <Button 
            onClick={startWebcam} 
            className="bg-green-600 hover:bg-green-700" 
            disabled={!selectedCameraId}
          >
            <Play className="h-4 w-4 mr-2" />
            Start Detection
          </Button>
        ) : (
          <Button onClick={stopWebcam} variant="destructive">
            <Square className="h-4 w-4 mr-2" />
            Stop Detection
          </Button>
        )}
      </div>
    </div>
  );
};
