package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

func main() {
	token := "token abim"
	serverID := "swid"
	password := "xxx"
	var mfaToken string
	var mfaMutex sync.Mutex
	for {
		if newToken := getMFAToken(token, serverID, password); newToken != "" {
			mfaMutex.Lock()
			mfaToken = newToken
			tokenData := map[string]string{"token": mfaToken}
			jsonData, _ := json.Marshal(tokenData)
			os.WriteFile("mfa_token.json", jsonData, 0644)
			fmt.Println("MFA token saved")
			mfaMutex.Unlock()
		} else {
			fmt.Println("Failed to get MFA token, retrying...")
		}
		time.Sleep(10 * time.Second)
	}
}
func getMFAToken(token, serverID, password string) string {
	client := &http.Client{Timeout: 3 * time.Second}
	req, _ := http.NewRequest("PATCH", "https://discord.com/api/v9/guilds/"+serverID+"/vanity-url", bytes.NewBufferString(`{"code":null}`))
	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	req.Header.Set("X-Super-Properties", "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6InRyLVRSIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkiLCJicm93c2VyX3ZlcnNpb24iOiIxMjEuMC4wLjAiLCJvc192ZXJzaW9uIjoiMTAiLCJyZWZlcnJlciI6IiIsInJlZmVycmluZ19kb21haW4iOiIiLCJyZWZlcnJlcl9jdXJyZW50IjoiIiwicmVmZXJyaW5nX2RvbWFpbl9jdXJyZW50IjoiIiwicmVsZWFzZV9jaGFubmVsIjoic3RhYmxlIiwiY2xpZW50X2J1aWxkX251bWJlciI6MjAwODQyLCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ==")
	resp, err := client.Do(req)
	if err != nil {
		fmt.Println("URL request error:", err)
		return ""
	}
	defer resp.Body.Close()
	var data map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return ""
	}
	var ticket string
	if mfa, ok := data["mfa"].(map[string]interface{}); ok && mfa["ticket"] != nil {
		ticket = mfa["ticket"].(string)
	} else if data["ticket"] != nil {
		ticket, _ = data["ticket"].(string)
	}
	if ticket == "" {
		fmt.Println("Failed to get MFA ticket")
		return ""
	}
	fmt.Println("MFA ticket received")
	mfaReq, _ := http.NewRequest("POST", "https://discord.com/api/v9/mfa/finish",
		bytes.NewBufferString(fmt.Sprintf(`{"ticket":"%s","mfa_type":"password","data":"%s"}`, ticket, password)))
	mfaReq.Header.Set("Authorization", token)
	mfaReq.Header.Set("Content-Type", "application/json")
	mfaReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	mfaReq.Header.Set("X-Super-Properties", "eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6InRyLVRSIiwiYnJvd3Nlcl91c2VyX2FnZW50IjoiTW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkiLCJicm93c2VyX3ZlcnNpb24iOiIxMjEuMC4wLjAiLCJvc192ZXJzaW9uIjoiMTAiLCJyZWZlcnJlciI6IiIsInJlZmVycmluZ19kb21haW4iOiIiLCJyZWZlcnJlcl9jdXJyZW50IjoiIiwicmVmZXJyaW5nX2RvbWFpbl9jdXJyZW50IjoiIiwicmVsZWFzZV9jaGFubmVsIjoic3RhYmxlIiwiY2xpZW50X2J1aWxkX251bWJlciI6MjAwODQyLCJjbGllbnRfZXZlbnRfc291cmNlIjpudWxsfQ==")
	mfaResp, err := client.Do(mfaReq)
	if err != nil {
		fmt.Println("Failed to send MFA request:", err)
		return ""
	}
	defer mfaResp.Body.Close()
	var tokenData map[string]interface{}
	if json.NewDecoder(mfaResp.Body).Decode(&tokenData) != nil {
		return ""
	}
	if newToken, ok := tokenData["token"].(string); ok {
		fmt.Println("Successfully obtained MFA token")
		return newToken
	}
	fmt.Println("Failed to get MFA token")
	return ""
}
