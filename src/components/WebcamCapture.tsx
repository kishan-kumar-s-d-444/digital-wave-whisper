import { useRef, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Camera, Settings, Wifi, WifiOff, Play, Square } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Detection {
  class: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WebcamCaptureProps {
  globalDetectionActive: boolean;
  onDetectionUpdate: (predictions: Detection[]) => void;
  onStatusChange: (isActive: boolean) => void;
  cameraId?: number;
}

const API_BASE_URL = "http://localhost:8000";

export const WebcamCapture = ({ globalDetectionActive, onDetectionUpdate, onStatusChange, cameraId = 1 }: WebcamCaptureProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [detectionInterval, setDetectionInterval] = useState<NodeJS.Timeout | null>(null);
  const [apiConnected, setApiConnected] = useState(false);
  const [isCheckingApi, setIsCheckingApi] = useState(false);

  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [overlapThreshold, setOverlapThreshold] = useState(0.5);
  const [opacityThreshold, setOpacityThreshold] = useState(0.75);
  const [labelDisplayMode, setLabelDisplayMode] = useState("Draw Confidence");
  const [processingTime, setProcessingTime] = useState<number>(0);

  const [recentDetections, setRecentDetections] = useState<{ detection: Detection; timestamp: number }[]>([]);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");

  // Handle global detection state changes
  useEffect(() => {
    if (globalDetectionActive && !isStreaming) {
      startWebcam();
    } else if (!globalDetectionActive && isStreaming) {
      stopWebcam();
    }
  }, [globalDetectionActive]);

  // Get available cameras on component mount
  useEffect(() => {
    const getCameras = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        setAvailableCameras(videoDevices);
        
        // Set default camera based on cameraId prop
        if (videoDevices.length > 0) {
          const defaultCamera = videoDevices[Math.min(cameraId - 1, videoDevices.length - 1)];
          setSelectedCameraId(defaultCamera.deviceId);
        }
      } catch (err) {
        console.error("Error getting cameras:", err);
        setError("Failed to get available cameras");
      }
    };

    getCameras();
  }, [cameraId]);

  const checkApiConnection = async () => {
    setIsCheckingApi(true);
    try {
      const response = await fetch(`${API_BASE_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        setApiConnected(true);
        setError("");
      } else {
        setApiConnected(false);
        setError("Backend API is not responding correctly");
      }
    } catch (err) {
      setApiConnected(false);
      setError("Cannot connect to backend API. Make sure the Python server is running on http://localhost:8000");
      console.error("API connection error:", err);
    } finally {
      setIsCheckingApi(false);
    }
  };

  const startWebcam = async () => {
    if (!apiConnected) {
      setError("Please ensure the backend API is running before starting detection");
      return;
    }

    if (!selectedCameraId) {
      setError("Please select a camera first");
      return;
    }

    try {
      const constraints = {
        video: {
          deviceId: selectedCameraId ? { exact: selectedCameraId } : undefined,
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 }
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

      const interval = setInterval(performDetection, 500);
      setDetectionInterval(interval);
    } catch (err) {
      setError("Failed to access webcam. Please ensure camera permissions are granted and the selected camera is available.");
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
    setRecentDetections([]);
  };

  const handleCameraChange = (deviceId: string) => {
    setSelectedCameraId(deviceId);
    
    // If currently streaming, restart with new camera
    if (isStreaming) {
      stopWebcam();
      setTimeout(() => {
        setSelectedCameraId(deviceId);
        if (globalDetectionActive) {
          startWebcam();
        }
      }, 100);
    }
  };

  const performDetection = async () => {
    if (!videoRef.current || !canvasRef.current || !apiConnected) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/jpeg', 0.8);

    try {
      const response = await fetch(`${API_BASE_URL}/detect_frame`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: imageData,
          confidence_threshold: confidenceThreshold,
          overlap_threshold: overlapThreshold
        }),
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      const now = Date.now();

      if (result.success && result.predictions) {
        const updatedDetections = [...recentDetections];

        result.predictions.forEach((pred) => {
          const existing = updatedDetections.find(
            (item) =>
              item.detection.class === pred.class &&
              Math.abs(item.detection.x - pred.x) < 10 &&
              Math.abs(item.detection.y - pred.y) < 10
          );

          if (existing) {
            existing.detection = pred;
            existing.timestamp = now;
          } else {
            updatedDetections.push({ detection: pred, timestamp: now });
          }
        });

        const filtered = updatedDetections.filter(item => now - item.timestamp <= 10000);

        setRecentDetections(filtered);
        onDetectionUpdate(filtered.map(d => d.detection));
        setProcessingTime(result.processing_time || 0);
      } else {
        console.warn("Detection failed:", result.error);
      }
    } catch (err) {
      console.error("Detection error:", err);
      if (err instanceof TypeError && err.message.includes('NetworkError')) {
        setApiConnected(false);
        setError("Lost connection to backend API");
      }
    }
  };

  const drawDetections = (
    ctx: CanvasRenderingContext2D,
    predictions: Detection[],
    width: number,
    height: number
  ) => {
    ctx.globalAlpha = opacityThreshold;

    predictions.forEach(({ x, y, width: boxWidth, height: boxHeight, class: className, confidence }) => {
      const boxX = x - boxWidth / 2;
      const boxY = y - boxHeight / 2;

      let color = '#00ff00';
      if (className.toLowerCase().includes('emergency')) color = '#ff0000';
      else if (className.toLowerCase().includes('truck')) color = '#ffff00';
      else if (className.toLowerCase().includes('car')) color = '#00ffff';

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

      if (labelDisplayMode === "Hidden") return;

      let label = className;
      if (labelDisplayMode === "Draw Confidence") {
        label = `${className} ${Math.round(confidence * 100)}%`;
      }

      ctx.font = '16px Arial';
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = `${color}CC`;
      ctx.fillRect(boxX, boxY - 25, textWidth + 10, 25);
      ctx.fillStyle = '#000000';
      ctx.fillText(label, boxX + 5, boxY - 5);
    });

    ctx.globalAlpha = 1.0;
  };

  // Continuous drawing loop
  useEffect(() => {
    let animationFrameId: number;

    const renderLoop = () => {
      const ctx = canvasRef.current?.getContext('2d');
      const video = videoRef.current;
      const now = Date.now();

      if (ctx && video && video.videoWidth > 0 && video.videoHeight > 0) {
        const canvas = canvasRef.current!;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const filtered = recentDetections.filter(d => now - d.timestamp <= 10000);
        drawDetections(ctx, filtered.map(d => d.detection), canvas.width, canvas.height);
      }

      animationFrameId = requestAnimationFrame(renderLoop);
    };

    animationFrameId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animationFrameId);
  }, [recentDetections, labelDisplayMode, opacityThreshold]);

  useEffect(() => {
    checkApiConnection();
    return () => stopWebcam();
  }, []);

  return (
    <div className="space-y-4">
      <Alert className={`${apiConnected ? 'bg-green-900/50 border-green-500' : 'bg-red-900/50 border-red-500'}`}>
        {apiConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        <AlertDescription className="text-white flex items-center justify-between">
          <span>Backend API: {apiConnected ? 'Connected' : 'Disconnected'}</span>
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
          <div>
            <label className="text-white text-sm mb-2 block">Select Camera:</label>
            <Select value={selectedCameraId} onValueChange={handleCameraChange}>
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
          </div>
        </CardContent>
      </Card>

      <Card className="bg-black/40 backdrop-blur-md border-white/20">
        <CardHeader>
          <CardTitle className="text-white flex items-center">
            <Settings className="h-5 w-5 mr-2" />
            Detection Parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-white text-sm mb-2 block">
              Confidence Threshold: {Math.round(confidenceThreshold * 100)}%
            </label>
            <Slider value={[confidenceThreshold]} onValueChange={(value) => setConfidenceThreshold(value[0])} min={0} max={1} step={0.01} />
          </div>
          <div>
            <label className="text-white text-sm mb-2 block">
              Overlap Threshold: {Math.round(overlapThreshold * 100)}%
            </label>
            <Slider value={[overlapThreshold]} onValueChange={(value) => setOverlapThreshold(value[0])} min={0} max={1} step={0.01} />
          </div>
          <div>
            <label className="text-white text-sm mb-2 block">
              Opacity Threshold: {Math.round(opacityThreshold * 100)}%
            </label>
            <Slider value={[opacityThreshold]} onValueChange={(value) => setOpacityThreshold(value[0])} min={0} max={1} step={0.01} />
          </div>
          <div>
            <label className="text-white text-sm mb-2 block">Label Display Mode:</label>
            <Select value={labelDisplayMode} onValueChange={setLabelDisplayMode}>
              <SelectTrigger className="bg-white/10 border-white/20 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Draw Confidence">Draw Confidence</SelectItem>
                <SelectItem value="Class Only">Class Only</SelectItem>
                <SelectItem value="Hidden">Hidden</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {processingTime > 0 && (
            <div className="text-purple-200 text-sm">
              Processing Time: {(processingTime * 1000).toFixed(1)}ms
            </div>
          )}
        </CardContent>
      </Card>

      <div className="relative bg-black rounded-lg overflow-hidden">
        <video ref={videoRef} className="w-full h-auto max-h-[400px] object-cover" muted playsInline />
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full object-cover" />
        {!isStreaming && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <div className="text-center text-white">
              <Camera className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>{globalDetectionActive ? "Starting detection..." : "No Camera Detection"}</p>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {!isStreaming ? (
          <Button onClick={startWebcam} className="bg-green-600 hover:bg-green-700" disabled={!apiConnected || !selectedCameraId}>
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
