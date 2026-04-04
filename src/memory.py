"""Professional RAG memory system with LanceDB vector storage."""
import hashlib
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Dict, Optional, Tuple

logger = logging.getLogger("linguclaw.memory")


@dataclass(frozen=True)
class CodeChunk:
    id: str
    file_path: str
    chunk_type: str  # 'function', 'class', 'module', 'section'
    name: str
    content: str
    start_line: int
    end_line: int
    embedding: Optional[List[float]] = None


class CodeIndexer:
    """Recursively indexes codebase into semantic chunks."""

    SUPPORTED_EXTS = {'.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.go', '.rs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php'}
    
    # Regex patterns for different languages
    PATTERNS = {
        'python': {
            'function': re.compile(r'^(def\s+\w+\s*\([^)]*\)\s*(->[^:]*)?:)', re.MULTILINE),
            'class': re.compile(r'^(class\s+\w+(\([^)]*\))?:)', re.MULTILINE),
        },
        'javascript': {
            'function': re.compile(r'^(function\s+\w+|const\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>|async\s+function\s+\w+)', re.MULTILINE),
            'class': re.compile(r'^(class\s+\w+(\s+extends\s+\w+)?\s*\{)', re.MULTILINE),
        },
        'typescript': {
            'function': re.compile(r'^((async\s*)?(function|const\s+\w+)\s*[<(])', re.MULTILINE),
            'class': re.compile(r'^(class\s+\w+(\s+implements?\s+[\w,\s]+)?\s*\{)', re.MULTILINE),
            'interface': re.compile(r'^(interface\s+\w+(\s+extends\s+\w+)?\s*\{)', re.MULTILINE),
        },
        'java': {
            'function': re.compile(r'^((public|private|protected|static|final|\s)+[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*\{)', re.MULTILINE),
            'class': re.compile(r'^((public|private)?\s*class\s+\w+)', re.MULTILINE),
        },
    }

    def __init__(self, project_root: str):
        self.project_root = Path(project_root).resolve()
        self.chunks: List[CodeChunk] = []

    def _detect_language(self, file_path: Path) -> str:
        ext = file_path.suffix.lower()
        mapping = {
            '.py': 'python', '.js': 'javascript', '.jsx': 'javascript',
            '.ts': 'typescript', '.tsx': 'typescript', '.java': 'java',
            '.go': 'go', '.rs': 'rust', '.cpp': 'cpp', '.c': 'c',
            '.h': 'c', '.hpp': 'cpp', '.rb': 'ruby', '.php': 'php',
        }
        return mapping.get(ext, 'unknown')

    def _extract_chunks(self, content: str, file_path: Path, language: str) -> List[CodeChunk]:
        chunks = []
        lines = content.split('\n')
        
        # Get patterns for this language, fallback to generic
        patterns = self.PATTERNS.get(language, self.PATTERNS.get('python', {}))
        
        # Find all definitions
        positions = []
        for chunk_type, pattern in patterns.items():
            for match in pattern.finditer(content):
                line_num = content[:match.start()].count('\n') + 1
                name = self._extract_name(match.group(0), chunk_type, language)
                positions.append((line_num, chunk_type, name, match.start()))
        
        if not positions:
            # No clear structure - treat as single module chunk
            chunk_id = hashlib.md5(f"{file_path}:module".encode()).hexdigest()[:16]
            return [CodeChunk(
                id=chunk_id,
                file_path=str(file_path.relative_to(self.project_root)),
                chunk_type='module',
                name=file_path.stem,
                content=content[:8000],  # Limit size
                start_line=1,
                end_line=len(lines),
            )]
        
        # Sort by position
        positions.sort(key=lambda x: x[0])
        
        # Extract chunks between positions
        for i, (start_line, chunk_type, name, start_pos) in enumerate(positions):
            if i + 1 < len(positions):
                end_pos = positions[i + 1][3]
                end_line = positions[i + 1][0] - 1
            else:
                end_pos = len(content)
                end_line = len(lines)
            
            chunk_content = content[start_pos:end_pos].strip()
            if len(chunk_content) > 100:  # Skip tiny chunks
                chunk_id = hashlib.md5(f"{file_path}:{name}:{start_line}".encode()).hexdigest()[:16]
                chunks.append(CodeChunk(
                    id=chunk_id,
                    file_path=str(file_path.relative_to(self.project_root)),
                    chunk_type=chunk_type,
                    name=name,
                    content=chunk_content[:4000],
                    start_line=start_line,
                    end_line=end_line,
                ))
        
        return chunks

    def _extract_name(self, signature: str, chunk_type: str, language: str) -> str:
        """Extract identifier name from signature."""
        try:
            if chunk_type == 'function':
                if language == 'python':
                    match = re.search(r'def\s+(\w+)', signature)
                    return match.group(1) if match else 'unknown'
                elif language in ('javascript', 'typescript'):
                    match = re.search(r'(function\s+(\w+)|const\s+(\w+))', signature)
                    if match:
                        return match.group(2) or match.group(3) or 'unknown'
                    return 'arrow_function'
                elif language == 'java':
                    match = re.search(r'(\w+)\s*\(', signature)
                    return match.group(1) if match else 'unknown'
            elif chunk_type == 'class':
                match = re.search(r'class\s+(\w+)', signature)
                return match.group(1) if match else 'unknown'
            elif chunk_type == 'interface':
                match = re.search(r'interface\s+(\w+)', signature)
                return match.group(1) if match else 'unknown'
        except Exception:
            pass
        return 'unknown'

    def scan_project(self, ignore_dirs: Optional[List[str]] = None) -> List[CodeChunk]:
        """Recursively scan project and index all code files."""
        ignore = set(ignore_dirs or ['.git', '__pycache__', 'node_modules', '.venv', 'venv', '.linguclaw', '.idea', '.vscode', 'dist', 'build'])
        chunks = []
        
        for root, dirs, files in os.walk(self.project_root):
            # Skip ignored directories
            dirs[:] = [d for d in dirs if d not in ignore and not d.startswith('.')]
            
            for file in files:
                file_path = Path(root) / file
                if file_path.suffix.lower() in self.SUPPORTED_EXTS:
                    try:
                        content = file_path.read_text(encoding='utf-8', errors='ignore')
                        language = self._detect_language(file_path)
                        file_chunks = self._extract_chunks(content, file_path, language)
                        chunks.extend(file_chunks)
                        logger.debug(f"Indexed {len(file_chunks)} chunks from {file_path}")
                    except Exception as e:
                        logger.warning(f"Failed to index {file_path}: {e}")
        
        self.chunks = chunks
        logger.info(f"Indexed {len(chunks)} chunks from project")
        return chunks


class VectorMemory:
    """LanceDB-based vector memory for semantic code search."""

    def __init__(self, persist_dir: str, dimension: int = 384):
        self.persist_dir = Path(persist_dir)
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self.dimension = dimension
        self._db = None
        self._table = None
        self._embedder = None
        self._init_db()

    def _init_db(self):
        """Initialize LanceDB connection."""
        try:
            import lancedb
            self._db = lancedb.connect(str(self.persist_dir))
            
            # Initialize sentence-transformers embedder
            try:
                from sentence_transformers import SentenceTransformer
                self._embedder = SentenceTransformer('all-MiniLM-L6-v2')
                logger.info("Loaded embedding model: all-MiniLM-L6-v2")
            except ImportError:
                logger.warning("sentence-transformers not available, using fallback")
                self._embedder = None
            
            # Open or create table
            try:
                self._table = self._db.open_table("code_memory")
                logger.info("Opened existing memory table")
            except Exception:
                import pyarrow as pa
                schema = pa.schema([
                    pa.field("id", pa.string()),
                    pa.field("file_path", pa.string()),
                    pa.field("chunk_type", pa.string()),
                    pa.field("name", pa.string()),
                    pa.field("content", pa.string()),
                    pa.field("start_line", pa.int32()),
                    pa.field("end_line", pa.int32()),
                    pa.field("vector", pa.list_(pa.float32(), self.dimension)),
                ])
                self._table = self._db.create_table("code_memory", schema=schema)
                logger.info("Created new memory table")
                
        except ImportError:
            logger.error("LanceDB not installed - RAG unavailable")
            self._db = None

    @property
    def available(self) -> bool:
        return self._db is not None and self._table is not None

    def _generate_embedding(self, text: str) -> List[float]:
        """Generate embedding vector for text."""
        if self._embedder:
            return self._embedder.encode(text, show_progress_bar=False).tolist()
        # Fallback: simple hash-based (not semantic, but deterministic)
        import numpy as np
        vec = np.zeros(self.dimension, dtype=np.float32)
        # Use hash to distribute values
        hash_val = int(hashlib.md5(text.encode()).hexdigest(), 16)
        np.random.seed(hash_val % (2**32))
        vec = np.random.randn(self.dimension).astype(np.float32)
        vec = vec / np.linalg.norm(vec)  # Normalize
        return vec.tolist()

    def add_chunks(self, chunks: List[CodeChunk]) -> int:
        """Add code chunks to vector memory."""
        if not self.available:
            logger.warning("Memory unavailable - skipping add")
            return 0
        
        import pyarrow as pa
        
        # Generate embeddings and prepare data
        data = []
        for chunk in chunks:
            embedding = self._generate_embedding(chunk.content)
            data.append({
                "id": chunk.id,
                "file_path": chunk.file_path,
                "chunk_type": chunk.chunk_type,
                "name": chunk.name,
                "content": chunk.content,
                "start_line": chunk.start_line,
                "end_line": chunk.end_line,
                "vector": embedding,
            })
        
        if data:
            self._table.add(pa.Table.from_pylist(data))
            logger.info(f"Added {len(data)} chunks to memory")
        
        return len(data)

    def search(self, query: str, k: int = 5) -> List[Dict]:
        """Semantic search over code memory."""
        if not self.available:
            logger.warning("Memory unavailable - returning empty results")
            return []
        
        query_embedding = self._generate_embedding(query)
        
        try:
            results = self._table.search(query_embedding).limit(k).to_list()
            logger.debug(f"Search '{query[:30]}...' returned {len(results)} results")
            return results
        except Exception as e:
            logger.error(f"Search failed: {e}")
            return []

    def get_stats(self) -> Dict:
        """Get memory statistics."""
        if not self.available:
            return {"available": False, "count": 0}
        try:
            count = self._table.count_rows()
            return {"available": True, "count": count, "dimension": self.dimension}
        except Exception:
            return {"available": True, "count": 0}


class RAGMemory:
    """High-level RAG interface integrating indexer and vector store."""

    def __init__(self, project_root: str):
        self.project_root = Path(project_root).resolve()
        self.memory_dir = self.project_root / ".linguclaw" / "memory"
        self.indexer = CodeIndexer(project_root)
        self.vector_store = VectorMemory(str(self.memory_dir))
        self._is_indexed = False

    @property
    def available(self) -> bool:
        return self.vector_store.available

    def index_project(self, force: bool = False) -> int:
        """Index the entire project into memory."""
        if self._is_indexed and not force:
            logger.info("Project already indexed")
            return 0
        
        if not self.available:
            logger.error("Cannot index - vector memory unavailable")
            return 0
        
        chunks = self.indexer.scan_project()
        added = self.vector_store.add_chunks(chunks)
        self._is_indexed = True
        return added

    def search(self, query: str, k: int = 5) -> str:
        """Search memory and format results for prompt injection."""
        if not self.available:
            return "[Memory unavailable - install lancedb and sentence-transformers]"
        
        if not self._is_indexed:
            # Auto-index on first search
            self.index_project()
        
        results = self.vector_store.search(query, k)
        if not results:
            return "[No relevant code found in memory]"
        
        formatted = ["[RELEVANT CODE CONTEXT]"]
        for i, r in enumerate(results, 1):
            formatted.append(f"\n--- Result {i}: {r['file_path']} ({r['chunk_type']}: {r['name']}) Lines {r['start_line']}-{r['end_line']} ---")
            content = r['content'][:800]  # Limit content length
            if len(r['content']) > 800:
                content += "..."
            formatted.append(content)
        
        return "\n".join(formatted)

    def auto_context(self, task: str) -> str:
        """Generate context for a given task (auto-context before THOUGHT)."""
        return self.search(task, k=3)

    def get_stats(self) -> Dict:
        return {
            "available": self.available,
            "indexed": self._is_indexed,
            "memory_dir": str(self.memory_dir),
            **self.vector_store.get_stats()
        }
