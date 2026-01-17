import pandas as pd
import pathlib
import os
import embedding_atlas
from embedding_atlas.data_source import DataSource
from embedding_atlas.options import make_embedding_atlas_props
from embedding_atlas.utils import Hasher
from embedding_atlas.version import __version__

# Configuration
INPUT_FILE = "streamlit/reviews_projected.parquet"
OUTPUT_ZIP = "atlas_export_clean.zip"

def generate_export():
    print(f"Loading {INPUT_FILE}...")
    df = pd.read_parquet(INPUT_FILE)
    
    # Ensure no FILE_NAME column
    if "FILE_NAME" in df.columns:
        print("Removing FILE_NAME column...")
        df = df.drop(columns=["FILE_NAME"])
    
    # Add row index if needed
    if "__row_index__" not in df.columns:
        df["__row_index__"] = range(len(df))
    
    # Column mappings (matching CLI args used earlier)
    # --x projection_x --y projection_y --text description --neighbors neighbors
    x_col = "projection_x"
    y_col = "projection_y"
    text_col = "description"
    neighbors_col = "neighbors"
    id_col = "__row_index__"
    
    print("Creating properties...")
    props = make_embedding_atlas_props(
        row_id=id_column if "id_column" in locals() else id_col, 
        x=x_col,
        y=y_col,
        neighbors=neighbors_col,
        text=text_col,
        point_size=None, # Default
        stop_words=None,
        labels=None
    )
    
    metadata = {
        "props": props,
    }
    
    # Hash for identifier
    hasher = Hasher()
    hasher.update(__version__)
    hasher.update([INPUT_FILE])
    hasher.update(metadata)
    identifier = hasher.hexdigest()
    
    print(f"Creating DataSource (ID: {identifier})...")
    dataset = DataSource(identifier, df, metadata)
    
    # Locate static files
    # embedding_atlas package path
    package_dir = pathlib.Path(embedding_atlas.__file__).parent
    static_path = str((package_dir / "static").resolve())
    print(f"Using static files from: {static_path}")
    
    print(f"Exporting to {OUTPUT_ZIP}...")
    with open(OUTPUT_ZIP, "wb") as f:
        f.write(dataset.make_archive(static_path))
        
    print("Done!")

if __name__ == "__main__":
    generate_export()
