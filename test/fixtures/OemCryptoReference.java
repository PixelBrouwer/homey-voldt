// Independent JDK/JCE reference for reconstructed APK HTTP crypto.
// Fixed artificial credentials only. Run with Java 21 source-file mode.
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.ByteArrayOutputStream;
import java.util.zip.GZIPOutputStream;

class OemCryptoReference {
  static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }
  static byte[] hmac(String key, String data) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(utf8(key), "HmacSHA256"));
    return mac.doFinal(utf8(data));
  }
  public static void main(String[] args) throws Exception {
    String cert = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    String colon = String.join(":", cert.toUpperCase(Locale.ROOT).split("(?<=\\G..)") );
    String secret = "com.example.vendor_" + colon + "_0123456789abcdef0123456789abcdef_fedcba9876543210fedcba9876543210";
    String requestId = "01234567-89ab-cdef-0123-456789abcdef";
    String plaintext = "{\"countryCode\":\"31\",\"username\":\"owner@example.test\",\"isUid\":false}";
    byte[] key = utf8(HexFormat.of().formatHex(hmac(requestId, secret)).substring(0,16));
    byte[] nonce = HexFormat.of().parseHex("000102030405060708090a0b");
    Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key,"AES"), new GCMParameterSpec(128,nonce));
    byte[] encrypted = cipher.doFinal(utf8(plaintext));
    byte[] frame = new byte[nonce.length+encrypted.length];
    System.arraycopy(nonce,0,frame,0,nonce.length);
    System.arraycopy(encrypted,0,frame,nonce.length,encrypted.length);
    String body = Base64.getEncoder().encodeToString(frame);
    String md5 = HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(utf8(body)));
    String shuffled = md5.substring(8,16)+md5.substring(0,8)+md5.substring(24,32)+md5.substring(16,24);
    String canonical = "a=smartlife.m.user.username.token.get||clientId=fixture-client||et=3||postData=" + shuffled + "||requestId=" + requestId + "||time=1792886400||v=2.0";
    String sid = "abcdef0123456789abcdef0123456789";
    StringBuilder shuffle = new StringBuilder();
    for(int i=0;i<16;i++) shuffle.append(sid.charAt(sid.charAt(i)&15));
    byte[] responseKey = utf8(HexFormat.of().formatHex(hmac(requestId, secret+"_"+shuffle)).substring(0,16));
    ByteArrayOutputStream compressed = new ByteArrayOutputStream();
    try(GZIPOutputStream gzip = new GZIPOutputStream(compressed)) { gzip.write(utf8("{\"success\":true,\"result\":{\"value\":42}}")); }
    cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(responseKey,"AES"),new GCMParameterSpec(128,nonce));
    byte[] responseEncrypted = cipher.doFinal(compressed.toByteArray());
    byte[] responseFrame = new byte[nonce.length+responseEncrypted.length];
    System.arraycopy(nonce,0,responseFrame,0,nonce.length);
    System.arraycopy(responseEncrypted,0,responseFrame,nonce.length,responseEncrypted.length);
    String responseBody = Base64.getEncoder().encodeToString(responseFrame);
    String responseSign = HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(utf8("result="+responseBody+"||t=1792886400||"+secret)));
    String ecode="fixture-ecode";
    byte[] businessKey=utf8(HexFormat.of().formatHex(hmac(requestId,secret+"_"+ecode)).substring(0,16));
    cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(businessKey,"AES"),new GCMParameterSpec(128,nonce));
    byte[] businessEncrypted=cipher.doFinal(compressed.toByteArray());
    byte[] businessFrame=new byte[nonce.length+businessEncrypted.length];
    System.arraycopy(nonce,0,businessFrame,0,nonce.length);
    System.arraycopy(businessEncrypted,0,businessFrame,nonce.length,businessEncrypted.length);
    String businessBody=Base64.getEncoder().encodeToString(businessFrame);
    String businessSign=HexFormat.of().formatHex(MessageDigest.getInstance("MD5").digest(utf8("result="+businessBody+"||t=1792886400||"+new String(businessKey,StandardCharsets.UTF_8))));
    String channelKey=HexFormat.of().formatHex(hmac("fixture-client","com.example.vendor_"+colon)).substring(8,16);
    System.out.println("{\"encryptedPostData\":\""+body+"\",\"signature\":\""+HexFormat.of().formatHex(hmac(secret,canonical))+"\",\"sessionSid\":\""+sid+"\",\"compressedResponse\":\""+responseBody+"\",\"outerSignature\":\""+responseSign+"\",\"businessEcode\":\""+ecode+"\",\"businessResponse\":\""+businessBody+"\",\"businessSignature\":\""+businessSign+"\",\"channelKey\":\""+channelKey+"\",\"reference\":\"Java21 JCE AES/GCM/NoPadding; HmacSHA256; GZIPOutputStream; MD5\"}");
  }
}
