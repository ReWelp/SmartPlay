class ChapterReader {
  constructor() {
    this.chapters = [];
  }
  
  readChapters() {
    this.chapters = [];
    const panels = document.querySelectorAll('ytd-macro-markers-list-item-renderer');
    
    if (panels.length === 0) return this.chapters;
    
    panels.forEach(panel => {
      const timeStr = panel.querySelector('#time')?.innerText?.trim();
      const title = panel.querySelector('#title')?.innerText?.trim();
      
      if (timeStr && title) {
        const parts = timeStr.split(':').reverse();
        let seconds = 0;
        for (let i = 0; i < parts.length; i++) {
          seconds += parseInt(parts[i], 10) * Math.pow(60, i);
        }
        
        this.chapters.push({ title, timeStr, seconds });
      }
    });
    
    return this.chapters.sort((a, b) => a.seconds - b.seconds);
  }
  
  getChapters() {
    return this.chapters.length > 0 ? this.chapters : this.readChapters();
  }
  
  destroy() {
    this.chapters = [];
  }
}
