# Conversion log design

## Location

The browser application cannot safely create or rotate folders in a user's local filesystem. A conversion log is therefore included in every downloaded dialogue ZIP:

```text
project-name.zip
├─ project-name.ustx
├─ Export/
│  └─ project-name_001.txt
└─ Log/
   └─ project-name_conversion.log
```

The existing standalone USTX download remains unchanged. The dialogue ZIP contains the dedicated `Log/` folder.

## LAB sidecar

The LAB export described in [the LAB export specification](lab-export-specification.md) adds a selectable ZIP content setting. `TXT only` remains the default and keeps the current ZIP layout. Selecting `TXT and LAB` adds a same-name sidecar file beside every dialogue TXT in `Export/`.

```text
Export/
├─ project-name_001.txt
└─ project-name_001.lab
```

The log records the selected ZIP content. For `TXT and LAB`, it also records each LAB path and its label count.

## Contents

The UTF-8 log contains the UTC generation time, source file and detected format, conversion settings, output naming option, result counts, and each track's name, singer setting, TXT path, and dialogue text.

## Retention and rotation

One ZIP is one immutable conversion snapshot and contains exactly one log. The application does not persist logs between browser sessions, overwrite an existing download, or accumulate files in a local directory. Consequently no time- or size-based rotation is needed: retaining or deleting each ZIP is controlled by the user.
