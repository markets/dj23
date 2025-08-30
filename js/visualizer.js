class Visualizer {
    constructor(audioContext, sourceNode, canvasId) {
        this.audioContext = audioContext;
        this.sourceNode = sourceNode;
        this.canvas = document.getElementById(canvasId);
        this.canvasCtx = this.canvas.getContext('2d');
        
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.bufferLength = this.analyser.frequencyBinCount;
        this.dataArray = new Uint8Array(this.bufferLength);
        
        this.sourceNode.connect(this.analyser);
        
        this.draw = this.draw.bind(this);
        
        this.init();
    }
    
    init() {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        
        // Start visualization
        this.draw();
    }
    
    draw() {
        requestAnimationFrame(this.draw);
        
        this.analyser.getByteFrequencyData(this.dataArray);
        
        // Clear canvas
        this.canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        const barWidth = (this.canvas.width / this.bufferLength) * 2.5;
        let x = 0;
        
        for (let i = 0; i < this.bufferLength; i++) {
            const barHeight = this.dataArray[i] / 2;
            
            // Gradient color based on frequency
            const hue = i / this.bufferLength * 360;
            this.canvasCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;
            
            this.canvasCtx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
    }
}