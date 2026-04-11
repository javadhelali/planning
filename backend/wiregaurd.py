def generate_allowed_ips(user_skips, exclude_private=True):
    # Internal dictionary to track which /16s to drop
    # Format: {first_octet: set(second_octets)}
    skips = {}

    def add_to_skips(ip_string):
        parts = ip_string.split('.')
        first = int(parts[0])
        second = parts[1]
        
        if first not in skips:
            skips[first] = set()
        
        if second.lower() == 'x':
            # If the whole octet is 'x', skip all 256 subnets
            for i in range(256):
                skips[first].add(i)
        else:
            skips[first].add(int(second))

    # 1. Process User Skips
    for ip in user_skips:
        add_to_skips(ip)

    # 2. Process Private/Local Ranges if requested
    if exclude_private:
        # 10.0.0.0/8
        add_to_skips("10.x.x.x")
        # 172.16.0.0/12 (172.16.x.x through 172.31.x.x)
        for i in range(16, 32):
            add_to_skips(f"172.{i}.x.x")
        # 192.168.0.0/16
        add_to_skips("192.168.x.x")

    allowed_ips = []

    # 3. Generate the CIDR list
    for a in range(256):
        if a in skips:
            # If the entire /8 is skipped, don't add anything for this octet
            if len(skips[a]) == 256:
                continue
            
            # Otherwise, add every /16 that isn't in the skip list
            for b in range(256):
                if b not in skips[a]:
                    allowed_ips.append(f"{a}.{b}.0.0/16")
        else:
            # Clean /8 range
            allowed_ips.append(f"{a}.0.0.0/8")

    return ", ".join(allowed_ips)

# --- Configuration ---
my_skips = ["185.142.x.x", "212.80.x.x", "185.173.x.x"]
result = generate_allowed_ips(my_skips, exclude_private=True)

print("AllowedIPs = 10.0.0.1/32, " + result)
