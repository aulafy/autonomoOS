import Foundation
import Security
// Secrets travel only via pipes, never arguments, environment, diagnostics or files.
let args = CommandLine.arguments
func fail() -> Never { FileHandle.standardError.write(Data("KEYCHAIN_OPERATION_FAILED\n".utf8)); exit(1) }
guard args.count == 3, ["get", "set", "delete"].contains(args[1]), args[2].range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { fail() }
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.autonomo-os.gmail", kSecAttrAccount as String: args[2], kSecAttrSynchronizable as String: false]
switch args[1] {
case "get":
 var lookup = query; lookup[kSecReturnData as String] = true; lookup[kSecMatchLimit as String] = kSecMatchLimitOne
 var item: CFTypeRef?; let status = SecItemCopyMatching(lookup as CFDictionary, &item)
 if status == errSecItemNotFound { exit(3) }
 guard status == errSecSuccess, let data = item as? Data else { fail() }
 FileHandle.standardOutput.write(data)
case "set":
 let data = FileHandle.standardInput.readDataToEndOfFile(); guard data.count > 0 && data.count < 65536 else { fail() }
 let update: [String: Any] = [kSecValueData as String: data]
 let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
 if status == errSecItemNotFound {
  var item = query; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
  guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { fail() }
 } else if status != errSecSuccess { fail() }
case "delete":
 let status = SecItemDelete(query as CFDictionary); guard status == errSecSuccess || status == errSecItemNotFound else { fail() }
default: fail()
}
