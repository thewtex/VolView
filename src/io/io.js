// How much data to read when extracting file magic
const HEAD_CHUNK = 512;

/**
 * special file types that we handle specifically
 */
export const FileTypes = {
  DICOM: 'dcm',
};

/**
 * file magic database
 * Used to handle certain cases where files have no extension
 */
export const FILE_MAGIC_DB = [
  {
    type: FileTypes.DICOM,
    skip: 128,
    header: Array.from('DICM').map((c) => c.charCodeAt(0)),
  },
];

function prefixEquals(target, prefix) {
  if (prefix.length > target.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] !== target[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Returns file type based on magic
 * @async
 * @param {File} file
 * @returns {string|null}
 */
export async function getFileMagic(file) {
  return new Promise((resolve) => {
    const head = file.slice(0, HEAD_CHUNK);
    const reader = new window.FileReader();
    reader.onload = () => {
      const chunk = new Uint8Array(reader.result);
      for (let i = 0; i < FILE_MAGIC_DB.length; i += 1) {
        const { type, header, skip = 0 } = FILE_MAGIC_DB[i];
        if (prefixEquals(chunk.slice(skip), header)) {
          resolve(type);
          return;
        }
      }
      resolve(null);
    };
    reader.readAsArrayBuffer(head);
  });
}

async function readFileAs(file, type) {
  return new Promise((resolve) => {
    const fio = new window.FileReader();
    fio.onload = () => resolve(fio.result);
    const method = `readAs${type}`;
    if (!fio[method]) {
      throw new TypeError(`readAs${type} is not a function`);
    }
    fio[method](file);
  });
}

/**
 * Reads a file and returns an ArrayBuffer
 * @async
 * @param {File} file
 */
export async function readFileAsArrayBuffer(file) {
  return readFileAs(file, 'ArrayBuffer');
}

/**
 * Reads a file and returns UTF-8 text
 * @async
 * @param {File} file
 */
export async function readFileAsUTF8Text(file) {
  return readFileAs(file, 'Text');
}

export class FileIO {
  constructor() {
    this.fileReaders = Object.create(null);
    this.typeAliases = Object.create(null);
    // Cache for file type. Prevents re-reading magic every time.
    this.typeCache = new WeakMap();
  }

  /**
   * readerFunc parses a given file.
   * @callback readerFunc
   * @param {File} file
   * @returns {any}
   */
  /**
   * Adds a reader for a file type.
   *
   * All file types are treated case-insensitively.
   * @param {String} fileType
   * @param {readerFunc} readerFunc
   */
  addSingleReader(fileType, readerFunc) {
    this.fileReaders[fileType.toLowerCase()] = readerFunc;
  }

  /**
   * Adds type aliases for a particular file type.
   *
   * All types are treated case-insensitively.
   * The baseType must already be registered to a reader.
   * Example: jpg is equivalent to jpeg
   *
   * @param {String} baseType
   * @param {String[]} aliases
   */
  addFileTypeAliases(baseType, aliases) {
    if (baseType.toLowerCase() in this.fileReaders) {
      aliases.forEach((alias) => {
        this.typeAliases[alias.toLowerCase()] = baseType;
      });
    }
  }

  /**
   * Infers the file type from a File object
   *
   * @async
   * @param {File} file
   * @returns {String|null}
   */
  async getFileType(file) {
    if (this.typeCache.has(file)) {
      return this.typeCache.get(file);
    }

    let type = null;

    // first see if file matches a registered type
    const registeredTypes = Object.keys(this.fileReaders);
    for (let i = 0; i < registeredTypes.length; i += 1) {
      if (file.name.toLowerCase().endsWith(`.${registeredTypes[i]}`)) {
        type = registeredTypes[i];
        break;
      }
    }

    if (!type) {
      // see if there's a type alias
      const aliases = Object.keys(this.typeAliases);
      for (let i = 0; i < aliases.length; i += 1) {
        if (file.name.toLowerCase().endsWith(`.${aliases[i]}`)) {
          type = this.typeAliases[aliases[i]];
          break;
        }
      }
    }

    if (!type) {
      // read file mimetype
      const magic = await getFileMagic(file);
      if (magic) {
        type = magic.toLowerCase();
      }
    }

    this.typeCache.set(file, type);
    return type;
  }

  /**
   * Determines if a file can be read.
   *
   * @async
   * @param {File} file
   * @returns {Boolean}
   */
  async canReadFile(file) {
    const type = await this.getFileType(file);
    return !!this.fileReaders[type];
  }

  /**
   * Parses a single file to produce a single output dataset.
   *
   * @async
   * @param {File} file
   * @returns {any}
   * @throws {Error}
   */
  async readSingleFile(file) {
    const type = await this.getFileType(file);
    if (!type) {
      throw new Error(`No type info found for ${file.name}`);
    }

    const reader = this.fileReaders[type];
    if (!reader) {
      throw new Error(`No reader found for ${file.name}`);
    }

    return reader(file);
  }
}
